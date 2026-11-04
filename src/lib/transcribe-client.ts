import {
  chunkRanges,
  downmixResample,
  encodeWav16,
  TARGET_RATE,
  UPLOAD_CHUNK_SECONDS,
  type ChunkRange,
} from "./audio-chunks";
import { emitCardChanged } from "./card-events";

/**
 * Browser half of upload transcripts. Decoding happens here because Workers
 * have no audio decoder and Whisper requests are size-capped: the attachment is
 * fetched through the Worker proxy (R2 presigned URLs lack CORS), decoded by the
 * browser, and sent to the server one fixed-length WAV chunk per request.
 */

const RETRY_DELAY_MS = 2000;

interface ErrorBody {
  error?: unknown;
}

interface DecodedUpload {
  pcm: Float32Array;
  ranges: ChunkRange[];
}

async function errorText(res: Response | null, fallback: string): Promise<string> {
  if (!res) return `${fallback}: network error`;
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error ? body.error : `${fallback} (${res.status})`;
}

async function decodeUpload(fileId: string): Promise<DecodedUpload> {
  const res = await fetch(`/api/files/${fileId}/original?proxy=1`).catch(() => null);
  if (!res?.ok) throw new Error(await errorText(res, "couldn't fetch the file"));
  const bytes = await res.arrayBuffer();
  const ctx = new AudioContext();
  const audio = await ctx
    .decodeAudioData(bytes)
    .catch(() => null)
    .finally(() => void ctx.close());
  if (!audio) throw new Error("this browser can't decode that file");
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const pcm = downmixResample(channels, audio.sampleRate);
  const ranges = chunkRanges(pcm.length, TARGET_RATE, UPLOAD_CHUNK_SECONDS);
  if (ranges.length === 0) throw new Error("no audio in that file");
  return { pcm, ranges };
}

/** PUTs every range not in `haveSeqs`, in order; a failed chunk is retried once before giving up. */
async function putChunks(
  cardId: string,
  { pcm, ranges }: DecodedUpload,
  haveSeqs: number[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const have: Record<number, true> = {};
  for (const seq of haveSeqs) have[seq] = true;
  let done = ranges.filter((r) => have[r.seq]).length;
  onProgress(done, ranges.length);
  for (const range of ranges) {
    if (have[range.seq]) continue;
    const wav = encodeWav16(pcm.subarray(range.from, range.to), TARGET_RATE);
    const put = () =>
      fetch(`/api/cards/${cardId}/transcribe/${range.seq}`, {
        method: "PUT",
        headers: {
          "content-type": "audio/wav",
          "x-start-ms": String(range.startMs),
          "x-end-ms": String(range.endMs),
        },
        body: wav,
      }).catch(() => null);
    let res = await put();
    if (!res?.ok) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RETRY_DELAY_MS);
      await promise;
      res = await put();
    }
    if (!res?.ok) throw new Error(await errorText(res, `chunk ${range.seq + 1} failed`));
    onProgress(++done, ranges.length);
  }
}

/**
 * Decodes the attached audio/video file, starts a fresh upload transcript sized
 * to its chunk count, and transcribes each chunk in turn. Throws with the
 * server's error text; the transcript stays `running` so `resumeUpload` can
 * pick up where it stopped.
 */
export async function transcribeUpload(
  cardId: string,
  fileId: string,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  try {
    const decoded = await decodeUpload(fileId);
    const res = await fetch(`/api/cards/${cardId}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "upload", fileId, totalChunks: decoded.ranges.length }),
    }).catch(() => null);
    if (!res?.ok) throw new Error(await errorText(res, "couldn't start transcript"));
    await putChunks(cardId, decoded, [], onProgress);
  } finally {
    emitCardChanged(cardId);
  }
}

/**
 * Continues an interrupted upload transcript without restarting it: the file is
 * decoded again (chunking is deterministic) and only seqs missing from
 * `haveSeqs` are sent.
 */
export async function resumeUpload(
  cardId: string,
  fileId: string,
  haveSeqs: number[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  try {
    await putChunks(cardId, await decodeUpload(fileId), haveSeqs, onProgress);
  } finally {
    emitCardChanged(cardId);
  }
}
