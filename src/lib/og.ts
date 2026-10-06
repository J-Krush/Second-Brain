import { eq } from "drizzle-orm";
import { parse, type HTMLElement } from "node-html-parser";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { clearRole, setRef } from "./filerefs";
import { ingestImageBytes } from "./files";

export interface OgData {
  title?: string;
  description?: string;
  image?: string; // file id of the cached image
  sourceUrl?: string; // original remote image url
}

const FETCH_TIMEOUT_MS = 8000;

// Hosts that answer datacenter IPs (the Worker) with a stripped page: no
// OpenGraph tags and a bare " - YouTube" <title>. Their oEmbed endpoint still
// returns the real title and thumbnail.
const OEMBED_ENDPOINT: Record<string, string> = {
  "youtube.com": "https://www.youtube.com/oembed",
  "youtu.be": "https://www.youtube.com/oembed",
};

interface Preview {
  title?: string;
  description?: string;
  imageUrl?: string;
}

async function fromOembed(endpoint: string, url: string): Promise<Preview | null> {
  const res = await fetchWithTimeout(`${endpoint}?format=json&url=${encodeURIComponent(url)}`, FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const data = (await res.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { title: str(data.title), description: str(data.author_name), imageUrl: str(data.thumbnail_url) };
}

async function fromHtml(url: string): Promise<Preview | null> {
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const root = parse(await res.text());
  const imageUrl = metaContent(root, ["og:image", "twitter:image"]);
  return {
    title: metaContent(root, ["og:title", "twitter:title"]) ?? root.querySelector("title")?.text?.trim(),
    description: metaContent(root, ["og:description", "twitter:description", "description"]),
    imageUrl: imageUrl && new URL(imageUrl, url).toString(),
  };
}

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
    const buf = Buffer.from(await res.arrayBuffer());
    return await ingestImageBytes(buf, mime);
  } catch {
    return null;
  }
}

/**
 * Fetch a link card's preview (oEmbed for hosts in `OEMBED_ENDPOINT`, else
 * OpenGraph/meta from the page), cache the image in R2, and write the metadata
 * into the card's props. Runs after save (via after()), so capture stays instant.
 */
export async function captureLink(cardId: string, url: string): Promise<void> {
  try {
    const endpoint = OEMBED_ENDPOINT[new URL(url).hostname.replace(/^(www|m|music)\./, "")];
    const preview = (endpoint && (await fromOembed(endpoint, url))) || (await fromHtml(url));
    if (!preview) return;

    const og: OgData = { title: preview.title, description: preview.description };
    if (preview.imageUrl) {
      const fileId = await ingestRemoteImage(preview.imageUrl);
      if (fileId) {
        og.image = fileId;
        og.sourceUrl = preview.imageUrl;
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
    const existing = (row?.props ?? {}) as Record<string, unknown> & { og?: OgData };
    const props = { ...existing, og };
    // Fill the title when the card has none or still carries the previous auto-filled one, so a
    // re-capture fixes a bad preview title but never overwrites a title the user typed.
    const patch: { props: Record<string, unknown>; title?: string } = { props };
    if (og.title && (!row?.title || row.title === existing.og?.title)) patch.title = og.title;
    await db.update(cards).set(patch).where(eq(cards.id, cardId));
  } catch {
    // Network/parse failures leave the card intact without a preview.
  }
}
