import { AwsClient } from "aws4fetch";
import { env } from "./env";

/**
 * Cloudflare R2 accessed purely through the S3 API (SigV4 via aws4fetch, which
 * runs on plain fetch + WebCrypto in both Workers and Node), so the backend
 * stays swappable (MinIO on a NAS, etc.). `R2_ENDPOINT` overrides the derived
 * Cloudflare endpoint for those alternatives. Path-style URLs keep MinIO and
 * R2 both happy.
 */
let client: AwsClient | undefined;

function s3(): AwsClient {
  if (client) return client;
  client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  return client;
}

function bucketUrl(): string {
  const endpoint =
    env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return `${endpoint.replace(/\/$/, "")}/${env.R2_BUCKET}`;
}

function objectUrl(key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${bucketUrl()}/${path}`;
}

const PRESIGN_TTL = 300; // 5 minutes, for both PUT and GET

async function presign(key: string, method: "GET" | "PUT"): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL));
  // No content-type is signed on PUT: the browser sends its own, and signing
  // it would force an exact header match on upload.
  const signed = await s3().sign(new Request(url, { method }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export function presignPut(key: string, _mime: string): Promise<string> {
  return presign(key, "PUT");
}

export function presignGet(key: string): Promise<string> {
  return presign(key, "GET");
}

export async function headObject(
  key: string,
): Promise<{ size: number; mime: string | undefined } | null> {
  try {
    const res = await s3().fetch(objectUrl(key), { method: "HEAD" });
    if (!res.ok) return null;
    return {
      size: Number(res.headers.get("content-length") ?? 0),
      mime: res.headers.get("content-type") ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  mime: string,
): Promise<void> {
  // Sign, then send the raw bytes ourselves: aws4fetch's own fetch re-wraps
  // the body in a Request, which Node sends chunked, and S3 PUT rejects a
  // missing Content-Length (411).
  const bytes = new Uint8Array(body);
  const signed = await s3().sign(objectUrl(key), {
    method: "PUT",
    body: bytes,
    headers: { "content-type": mime },
  });
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text()}`);
  }
}

export async function getObjectBytes(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().fetch(objectUrl(key));
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function xmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

/**
 * ListObjectsV2, parsed with regexes rather than an XML parser (none exists
 * in the Workers runtime). Safe because every key this app writes is
 * `files/<uuid>/<name>.<ext>`: plain ASCII with no markup characters.
 */
export async function listPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(bucketUrl());
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await s3().fetch(url);
    if (!res.ok) {
      throw new Error(`R2 list ${prefix} failed: ${res.status} ${await res.text()}`);
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(xmlText(m[1]!));
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = truncated && next ? xmlText(next[1]!) : undefined;
  } while (token);
  return keys;
}

export async function deleteByPrefix(prefix: string): Promise<number> {
  const keys = await listPrefix(prefix);
  await deleteKeys(keys);
  return keys.length;
}

const DELETE_CONCURRENCY = 20;

/**
 * Individual DELETEs in parallel batches. The multi-object `?delete` API
 * needs a Content-MD5 header, and MD5 is not available in WebCrypto.
 * Deleting a missing key is a 204 in S3, so retries are idempotent.
 */
export async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
    const batch = keys.slice(i, i + DELETE_CONCURRENCY);
    await Promise.all(
      batch.map(async (key) => {
        const res = await s3().fetch(objectUrl(key), { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
        }
      }),
    );
  }
}
