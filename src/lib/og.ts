import { eq } from "drizzle-orm";
import { parse, type HTMLElement } from "node-html-parser";
import { db } from "@/db";
import { cards, files } from "@/db/schema";
import { clearRole, setRef } from "./filerefs";
import { confirmUpload, extForMime, sha256Hex } from "./files";
import { putObject } from "./r2";

export interface OgData {
  title?: string;
  description?: string;
  image?: string; // file id of the cached image
  sourceUrl?: string; // original remote image url
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function metaContent(root: HTMLElement, names: string[]): string | undefined {
  for (const name of names) {
    const el =
      root.querySelector(`meta[property="${name}"]`) ??
      root.querySelector(`meta[name="${name}"]`);
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "SecondBrainBot/1.0 (+link-preview)" },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Download a remote image into R2 as a deduped, thumbnailed file. Returns the
 * file id, or null on any failure (boards must never depend on remote images,
 * so we cache the bytes we control).
 */
async function ingestRemoteImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(imageUrl, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;

    const sha = sha256Hex(buf);
    const [existing] = await db
      .select()
      .from(files)
      .where(eq(files.sha256, sha))
      .limit(1);
    if (existing?.status === "active") return existing.id;

    const row =
      existing ??
      (
        await db
          .insert(files)
          .values({
            r2Prefix: "",
            mime,
            bytes: buf.length,
            sha256: sha,
            status: "pending",
          })
          .returning()
      )[0]!;
    if (!row.r2Prefix) {
      row.r2Prefix = `files/${row.id}/`;
      await db.update(files).set({ r2Prefix: row.r2Prefix }).where(eq(files.id, row.id));
    }
    await putObject(`${row.r2Prefix}original.${extForMime(mime)}`, buf, mime);
    await confirmUpload(row.id);
    return row.id;
  } catch {
    return null;
  }
}

/**
 * Fetch a link card's URL, parse OpenGraph/meta, cache the OG image in R2, and
 * write the metadata into the card's props. Runs after save (via after()), so
 * capture stays instant.
 */
export async function captureLink(cardId: string, url: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return;
    const html = await res.text();
    const root = parse(html);

    const og: OgData = {
      title:
        metaContent(root, ["og:title", "twitter:title"]) ??
        root.querySelector("title")?.text?.trim(),
      description: metaContent(root, [
        "og:description",
        "twitter:description",
        "description",
      ]),
    };

    const imageUrl = metaContent(root, ["og:image", "twitter:image"]);
    if (imageUrl) {
      const absolute = new URL(imageUrl, url).toString();
      const fileId = await ingestRemoteImage(absolute);
      if (fileId) {
        og.image = fileId;
        og.sourceUrl = absolute;
        await clearRole(cardId, "og_cache");
        await setRef(fileId, cardId, "og_cache");
      }
    }

    // Merge into existing props without clobbering other keys.
    const [row] = await db
      .select({ props: cards.props, title: cards.title })
      .from(cards)
      .where(eq(cards.id, cardId))
      .limit(1);
    const props = { ...((row?.props as Record<string, unknown>) ?? {}), og };
    // Only auto-fill the title when the card doesn't already have one.
    const patch: { props: Record<string, unknown>; title?: string } = { props };
    if (!row?.title && og.title) patch.title = og.title;
    await db.update(cards).set(patch).where(eq(cards.id, cardId));
  } catch {
    // Network/parse failures leave the card intact without a preview.
  }
}
