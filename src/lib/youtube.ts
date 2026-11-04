import type { TranscriptChunk } from "./transcripts";

/**
 * Pure YouTube helpers shared by the server (caption capture) and the client
 * (deciding whether a card offers captions, timestamp links).
 */

const YOUTUBE_HOSTS: Record<string, true> = {
  "youtube.com": true,
  "www.youtube.com": true,
  "m.youtube.com": true,
  "music.youtube.com": true,
};
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// Path prefixes whose next segment is the video id.
const ID_PATHS: Record<string, true> = { shorts: true, embed: true, live: true };

/**
 * The 11-character video id of a YouTube URL (watch, youtu.be, shorts, embed,
 * live), or null for anything else, so callers never fetch captions for a
 * look-alike host or a truncated id.
 */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined;
  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS[host]) {
    const [first, second] = segments;
    if (first === "watch") candidate = parsed.searchParams.get("v");
    else if (first && ID_PATHS[first]) candidate = second;
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** Watch URL that starts playback at the given offset (whole seconds, as YouTube's `t` expects). */
export function youtubeTimestampUrl(id: string, startMs: number): string {
  return `https://www.youtube.com/watch?v=${id}&t=${Math.floor(startMs / 1000)}s`;
}

/** One event of YouTube's json3 caption format. */
export interface CaptionEvent {
  tStartMs: number;
  dDurationMs?: number;
  segs?: { utf8: string }[];
}

/**
 * Fold caption events into passages of at most `maxChars` (one event longer
 * than that stands alone), breaking only between events so every passage
 * keeps an exact start time for timestamp links. Events without text (window
 * setup, bare newlines) are dropped.
 */
export function groupCaptionEvents(events: CaptionEvent[], maxChars = 1200): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptChunk | null = null;
  for (const event of events) {
    if (!event.segs) continue;
    const text = event.segs
      .map((s) => s.utf8)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const endMs = event.tStartMs + (event.dDurationMs ?? 0);
    if (current && current.text.length + 1 + text.length <= maxChars) {
      current.text += ` ${text}`;
      current.endMs = endMs;
      continue;
    }
    current = { seq: chunks.length, startMs: event.tStartMs, endMs, text };
    chunks.push(current);
  }
  return chunks;
}
