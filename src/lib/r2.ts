import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

/**
 * Cloudflare R2 accessed purely through the S3 API, so the backend stays
 * swappable (MinIO on a NAS, etc.). `R2_ENDPOINT` overrides the derived
 * Cloudflare endpoint for those alternatives. forcePathStyle keeps MinIO and
 * R2 both happy.
 */
let client: S3Client | undefined;

function s3(): S3Client {
  if (client) return client;
  const endpoint =
    env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    // Recent AWS SDK v3 injects x-amz-checksum-* into presigned URLs by
    // default; R2 and browser fetch PUTs reject those. Only add checksums when
    // an operation actually requires them, keeping presigned PUTs clean.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

const PRESIGN_TTL = 300; // 5 minutes, for both PUT and GET

export function presignPut(key: string, mime: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: PRESIGN_TTL },
  );
}

export function presignGet(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: PRESIGN_TTL },
  );
}

export async function headObject(
  key: string,
): Promise<{ size: number; mime: string | undefined } | null> {
  try {
    const res = await s3().send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
    return { size: res.ContentLength ?? 0, mime: res.ContentType };
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  mime: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: mime,
    }),
  );
}

export async function getObjectBytes(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

export async function listPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function deleteByPrefix(prefix: string): Promise<number> {
  const keys = await listPrefix(prefix);
  await deleteKeys(keys);
  return keys.length;
}

export async function deleteKeys(keys: string[]): Promise<void> {
  // DeleteObjects caps at 1000 keys per request.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: env.R2_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}
