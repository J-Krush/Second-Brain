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

interface Preview {
  og: OgData;
  imageUrl?: string;
}

// youtube.com/oembed field subset; no key required.
interface YoutubeOembed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

const YOUTUBE_HOSTS: Record<string, true> = {
  "youtube.com": true,
  "www.youtube.com": true,
  "m.youtube.com": true,
  "youtu.be": true,
};

// Instagram serves a login wall with `<title>Instagram</title>` and no OG tags
// to every non-browser client, so fetching would only overwrite nothing with
// noise. The card keeps its URL and whatever the share sheet sent.
const NO_PREVIEW_HOSTS: Record<string, true> = {
  "instagram.com": true,
  "www.instagram.com": true,
};

async function pagePreview(url: string): Promise<Preview | null> {
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const root = parse(await res.text());
  const imageUrl = metaContent(root, ["og:image", "twitter:image"]);
  return {
    og: {
      title: metaContent(root, ["og:title", "twitter:title"]) ?? root.querySelector("title")?.text?.trim(),
      description: metaContent(root, ["og:description", "twitter:description", "description"]),
    },
    imageUrl: imageUrl ? new URL(imageUrl, url).toString() : undefined,
  };
}

// YouTube's watch page is a consent wall from many datacenter IPs; oEmbed is a
// stable JSON contract that works from anywhere.
async function youtubePreview(url: string): Promise<Preview | null> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as YoutubeOembed;
  return { og: { title: data.title, description: data.author_name }, imageUrl: data.thumbnail_url };
}

/**
 * Fetch a link card's preview (YouTube via oEmbed, everything else via
 * OpenGraph/meta), cache the image in R2, and write the metadata into the
 * card's props. Runs after save (via after()), so capture stays instant.
 */
export async function captureLink(cardId: string, url: string): Promise<void> {
  try {
    const host = new URL(url).hostname;
    if (NO_PREVIEW_HOSTS[host]) return;
    const preview = (YOUTUBE_HOSTS[host] ? await youtubePreview(url) : null) ?? (await pagePreview(url));
    if (!preview) return;
    const { og, imageUrl } = preview;

    if (imageUrl) {
      const fileId = await ingestRemoteImage(imageUrl);
      if (fileId) {
        og.image = fileId;
        og.sourceUrl = imageUrl;
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
