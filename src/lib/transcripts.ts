import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cardChunks, cards, fileRefs, files, transcripts } from "@/db/schema";
import { embedTexts, toVectorLiteral } from "./embeddings";
import { aiBinding, aiRest, workersAiConfigured, type WhisperInput, type WhisperOutput } from "./workers-ai";
import { groupCaptionEvents, youtubeVideoId, type CaptionEvent } from "./youtube";

export type TranscriptStatus = "pending" | "running" | "done" | "unavailable" | "failed";
export type TranscriptSource = "youtube" | "upload";

export interface TranscriptChunk {
  seq: number;
  startMs: number | null;
  endMs: number | null;
  text: string;
}

export interface Transcript {
  status: TranscriptStatus;
  source: TranscriptSource;
  fileId: string | null;
  language: string | null;
  model: string | null;
  totalChunks: number | null;
  error: string | null;
  updatedAt: Date;
  chunks: TranscriptChunk[];
}

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const MAX_CHUNK_BYTES = 12 * 1024 * 1024; // 240 s × 16 kHz × 2 B = 7.7 MB + headroom

// bge-m3 batch size: big enough to amortise the call, small enough to stay well under request limits.
const EMBED_BATCH = 16;
const FETCH_TIMEOUT_MS = 10_000;
// A youtube capture that has not moved for this long died with its request; the sweep restarts it.
const STALE_CAPTURE_MS = 10 * 60 * 1000;
// Desktop browser headers for every YouTube request (player and timedtext).
const YOUTUBE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "accept-language": "en-US,en",
};
// The WEB Innertube client now answers UNPLAYABLE ("page needs to be reloaded") without a
// proof-of-origin token; the ANDROID client still returns caption tracks with plain fetchable URLs.
const INNERTUBE_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 };

/** The card's transcript with its chunks in order, or null when none was ever started. */
export async function getTranscript(cardId: string): Promise<Transcript | null> {
  const [row] = await db.select().from(transcripts).where(eq(transcripts.cardId, cardId)).limit(1);
  if (!row) return null;
  const chunks = await db
    .select({
      seq: cardChunks.seq,
      startMs: cardChunks.startMs,
      endMs: cardChunks.endMs,
      text: cardChunks.text,
    })
    .from(cardChunks)
    .where(eq(cardChunks.cardId, cardId))
    .orderBy(asc(cardChunks.seq));
  return {
    status: row.status,
    source: row.source,
    fileId: row.fileId,
    language: row.language,
    model: row.model,
    totalChunks: row.totalChunks,
    error: row.error,
    updatedAt: row.updatedAt,
    chunks,
  };
}

interface TranscriptReset {
  status: TranscriptStatus;
  source: TranscriptSource;
  fileId: string | null;
  model: string | null;
  totalChunks: number | null;
}

// (Re)start a transcript from scratch: one row per card, old chunks gone, so a redo never mixes sources.
async function resetTranscript(cardId: string, reset: TranscriptReset): Promise<Transcript> {
  const fields = { ...reset, language: null, error: null, updatedAt: new Date() };
  await db
    .insert(transcripts)
    .values({ cardId, ...fields })
    .onConflictDoUpdate({ target: transcripts.cardId, set: fields });
  await db.delete(cardChunks).where(eq(cardChunks.cardId, cardId));
  const transcript = await getTranscript(cardId);
  if (!transcript) throw new Error(`transcript for ${cardId} vanished during reset`);
  return transcript;
}

/**
 * Queue a caption capture for a YouTube card. The fetch itself runs in
 * `captureYoutubeCaptions` (via after()), so the request returns at once.
 */
export async function startYoutubeTranscript(cardId: string, url: string): Promise<Transcript> {
  if (!youtubeVideoId(url)) throw new Error(`not a YouTube video url: ${url}`);
  return resetTranscript(cardId, {
    status: "pending",
    source: "youtube",
    fileId: null,
    model: null,
    totalChunks: null,
  });
}

// Boundary types for the slices of YouTube's Innertube player and json3 timedtext responses read here.
interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
}
interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}
interface TimedTextResponse {
  events?: CaptionEvent[];
}

type CaptionFetch =
  | { status: "done"; chunks: TranscriptChunk[]; language: string; model: string }
  | { status: "unavailable" | "failed"; error: string };

async function youtubeFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Human captions beat auto-generated ones, English beats other languages; otherwise take what exists.
function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const english = (t: CaptionTrack) => t.languageCode.toLowerCase().startsWith("en");
  return (
    tracks.find((t) => english(t) && t.kind !== "asr") ??
    tracks.find((t) => english(t) && t.kind === "asr") ??
    tracks[0]
  );
}

async function fetchYoutubeCaptions(videoId: string): Promise<CaptionFetch> {
  const playerRes = await youtubeFetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { ...YOUTUBE_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ context: { client: INNERTUBE_CLIENT }, videoId }),
  });
  if (!playerRes.ok) return { status: "failed", error: `player: HTTP ${playerRes.status}` };
  const player = (await playerRes.json()) as PlayerResponse;

  // LOGIN_REQUIRED (private, age-gated), ERROR (removed), UNPLAYABLE, ...: report YouTube's reason
  // rather than claiming the video has no captions.
  const playability = player.playabilityStatus?.status;
  if (playability && playability !== "OK") {
    return { status: "failed", error: player.playabilityStatus?.reason ?? playability };
  }

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = pickCaptionTrack(tracks);
  if (!track) return { status: "unavailable", error: "this video has no captions" };

  const trackUrl = new URL(track.baseUrl, "https://www.youtube.com");
  trackUrl.searchParams.set("fmt", "json3");
  const textRes = await youtubeFetch(trackUrl.toString(), { headers: YOUTUBE_HEADERS });
  if (!textRes.ok) return { status: "failed", error: `timedtext: HTTP ${textRes.status}` };
  // YouTube answers some caption requests with 200 and an empty body instead of an error.
  const raw = await textRes.text();
  if (!raw.trim()) return { status: "failed", error: "timedtext: empty response" };
  const timedText = JSON.parse(raw) as TimedTextResponse;

  const chunks = groupCaptionEvents(timedText.events ?? []);
  if (chunks.length === 0) return { status: "unavailable", error: "caption track is empty" };
  return {
    status: "done",
    chunks,
    language: track.languageCode,
    model: track.kind === "asr" ? "youtube:asr" : "youtube:manual",
  };
}

async function setStatus(
  cardId: string,
  patch: { status: TranscriptStatus; error?: string | null; language?: string; model?: string },
): Promise<void> {
  await db
    .update(transcripts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(transcripts.cardId, cardId), eq(transcripts.source, "youtube")));
}

/**
 * Background worker behind a youtube transcript: fetch the caption track,
 * store it as timestamped chunks, embed them, and record the terminal status.
 * Never throws, because it runs in after() where nobody would see the error;
 * failures land in the row's `error` for the UI instead.
 */
export async function captureYoutubeCaptions(cardId: string): Promise<void> {
  try {
    const [card] = await db
      .select({ url: cards.url })
      .from(cards)
      .where(and(eq(cards.id, cardId), isNull(cards.deletedAt)))
      .limit(1);
    const videoId = youtubeVideoId(card?.url);
    if (!videoId) {
      await setStatus(cardId, { status: "failed", error: "card has no YouTube url" });
      return;
    }
    await setStatus(cardId, { status: "running", error: null });

    const result = await fetchYoutubeCaptions(videoId);
    if (result.status !== "done") {
      await setStatus(cardId, { status: result.status, error: result.error });
      return;
    }

    // The transcript may have been deleted or switched to an upload while we fetched.
    const [row] = await db
      .select({ source: transcripts.source })
      .from(transcripts)
      .where(eq(transcripts.cardId, cardId))
      .limit(1);
    if (row?.source !== "youtube") return;

    await db.delete(cardChunks).where(eq(cardChunks.cardId, cardId));
    await db.insert(cardChunks).values(result.chunks.map((c) => ({ cardId, ...c })));
    try {
      await embedPendingChunks(result.chunks.length, cardId);
    } catch {
      // Embedding is best-effort here; sweepTranscripts picks up chunks left without a vector.
    }
    await setStatus(cardId, {
      status: "done",
      error: null,
      language: result.language,
      model: result.model,
    });
  } catch (err) {
    try {
      await setStatus(cardId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // The DB itself is unreachable; the sweep retries the still-pending row.
    }
  }
}

/**
 * Whether `fileId` may back an upload transcript of `cardId`: the card
 * references it (any role), it finished uploading, and it is audio or video.
 * Guards against transcribing someone else's attachment by id.
 */
export async function isTranscribableFile(cardId: string, fileId: string): Promise<boolean> {
  const [row] = await db
    .select({ mime: files.mime })
    .from(fileRefs)
    .innerJoin(files, eq(files.id, fileRefs.fileId))
    .where(and(eq(fileRefs.cardId, cardId), eq(fileRefs.fileId, fileId), eq(files.status, "active")))
    .limit(1);
  return Boolean(row && (row.mime.startsWith("audio/") || row.mime.startsWith("video/")));
}

/** Begin a browser-driven upload transcript of `totalChunks` WAV pieces of an attached audio/video file. */
export async function startUploadTranscript(
  cardId: string,
  fileId: string,
  totalChunks: number,
): Promise<Transcript> {
  return resetTranscript(cardId, {
    status: "running",
    source: "upload",
    fileId,
    model: WHISPER_MODEL,
    totalChunks,
  });
}

// Response boundary for POST /accounts/{id}/ai/run/@cf/openai/whisper-large-v3-turbo.
interface WorkersAiWhisperResponse {
  success: boolean;
  errors?: { message: string }[];
  result?: WhisperOutput;
}

async function runWhisper(input: WhisperInput): Promise<WhisperOutput> {
  const binding = aiBinding();
  if (binding) return binding.run(WHISPER_MODEL, input);
  const res = await aiRest(WHISPER_MODEL, input);
  const data = (await res.json()) as WorkersAiWhisperResponse;
  if (!res.ok || !data.success || !data.result) {
    throw new Error(`Workers AI whisper failed: ${data.errors?.[0]?.message ?? res.status}`);
  }
  return data.result;
}

/**
 * Transcribe one uploaded WAV chunk synchronously and store it under `seq`
 * (re-sending a seq overwrites it, so the client can retry or resume). The
 * transcript turns `done` once every seq is stored. Whisper failures throw
 * and leave the row `running` for a retry.
 */
export async function storeUploadChunk(
  cardId: string,
  seq: number,
  startMs: number,
  endMs: number,
  wav: Uint8Array,
): Promise<{ text: string; done: boolean }> {
  const result = await runWhisper({ audio: Buffer.from(wav).toString("base64"), vad_filter: true });
  const text = result.text.trim();

  await db
    .insert(cardChunks)
    .values({ cardId, seq, startMs, endMs, text })
    .onConflictDoUpdate({
      target: [cardChunks.cardId, cardChunks.seq],
      set: { startMs, endMs, text, embedding: null },
    });

  const language = result.transcription_info?.language;
  if (language) {
    await db
      .update(transcripts)
      .set({ language })
      .where(and(eq(transcripts.cardId, cardId), isNull(transcripts.language)));
  }

  const [stored] = await db
    .select({ n: count() })
    .from(cardChunks)
    .where(eq(cardChunks.cardId, cardId));
  const [row] = await db
    .select({ totalChunks: transcripts.totalChunks })
    .from(transcripts)
    .where(eq(transcripts.cardId, cardId))
    .limit(1);
  const done = row?.totalChunks != null && (stored?.n ?? 0) >= row.totalChunks;
  await db
    .update(transcripts)
    .set(done ? { status: "done", error: null, updatedAt: new Date() } : { updatedAt: new Date() })
    .where(eq(transcripts.cardId, cardId));

  try {
    await embedPendingChunks(1, cardId);
  } catch {
    // Best-effort: the chunk is stored and searchable by text; the sweep embeds it later.
  }
  return { text, done };
}

/** Remove a card's transcript and all its chunks. */
export async function deleteTranscript(cardId: string): Promise<void> {
  await db.delete(cardChunks).where(eq(cardChunks.cardId, cardId));
  await db.delete(transcripts).where(eq(transcripts.cardId, cardId));
}

/**
 * Embed transcript chunks that have text but no vector, oldest first, in
 * bge-m3 batches. `cardId` narrows it to one card right after a capture.
 * Returns how many chunks were embedded.
 */
export async function embedPendingChunks(limit = 100, cardId?: string): Promise<number> {
  if (!workersAiConfigured()) return 0;
  const pending = await db
    .select({ id: cardChunks.id, text: cardChunks.text })
    .from(cardChunks)
    .where(
      and(
        isNull(cardChunks.embedding),
        // Silent upload chunks store empty text; they have nothing to embed.
        sql`length(trim(${cardChunks.text})) > 0`,
        cardId ? eq(cardChunks.cardId, cardId) : undefined,
      ),
    )
    .orderBy(asc(cardChunks.id))
    .limit(limit);

  let embedded = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((c) => c.text));
    for (const [j, chunk] of batch.entries()) {
      const vec = vectors[j];
      if (!vec) continue;
      await db
        .update(cardChunks)
        .set({ embedding: sql`${toVectorLiteral(vec)}::vector` })
        .where(eq(cardChunks.id, chunk.id));
      embedded += 1;
    }
  }
  return embedded;
}

/**
 * Cron/admin catch-up: restart youtube captures whose after() worker died
 * (stuck pending/running for over 10 minutes), then embed leftover chunks.
 */
export async function sweepTranscripts(): Promise<{ retried: number; chunksEmbedded: number }> {
  const stale = await db
    .select({ cardId: transcripts.cardId })
    .from(transcripts)
    .where(
      and(
        eq(transcripts.source, "youtube"),
        inArray(transcripts.status, ["pending", "running"]),
        lt(transcripts.updatedAt, new Date(Date.now() - STALE_CAPTURE_MS)),
      ),
    );
  for (const row of stale) await captureYoutubeCaptions(row.cardId);
  const chunksEmbedded = await embedPendingChunks(200);
  return { retried: stale.length, chunksEmbedded };
}
