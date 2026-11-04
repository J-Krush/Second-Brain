/**
 * Browser-side audio preparation for upload transcripts. Whisper on Workers AI
 * takes a whole file per request and a Worker request body is capped, so the
 * browser decodes the attachment, flattens it to 16 kHz mono 16-bit WAV (what
 * Whisper resamples to anyway), and sends it in fixed-length pieces. Pure so it
 * runs under vitest without an AudioContext.
 */

export const TARGET_RATE = 16000;

/**
 * Seconds of audio per uploaded chunk, chosen client-side because the browser
 * does the cutting: 240 s × 16 kHz × 2 B ≈ 7.7 MB stays under the server's
 * MAX_CHUNK_BYTES (12 MB) in `transcripts.ts`.
 */
export const UPLOAD_CHUNK_SECONDS = 240;

/**
 * Averages all channels into one and linearly resamples it from `fromRate` to
 * `toRate`. The output has `round(n * toRate / fromRate)` samples and keeps the
 * first and last input samples at its ends.
 */
export function downmixResample(channels: Float32Array[], fromRate: number, toRate = TARGET_RATE): Float32Array {
  const n = channels.reduce((min, c) => Math.min(min, c.length), channels[0]?.length ?? 0);
  const mono = new Float32Array(n);
  for (const channel of channels) {
    for (let i = 0; i < n; i++) mono[i]! += channel[i]! / channels.length;
  }
  if (fromRate === toRate) return mono;

  const m = Math.round((n * toRate) / fromRate);
  const out = new Float32Array(m);
  if (m === 0 || n === 0) return out;
  if (m === 1 || n === 1) {
    out.fill(mono[0]!);
    return out;
  }
  // Map output endpoints onto input endpoints so nothing is dropped or extrapolated.
  const step = (n - 1) / (m - 1);
  for (let i = 0; i < m; i++) {
    const pos = i * step;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, n - 1);
    const frac = pos - lo;
    out[i] = mono[lo]! + (mono[hi]! - mono[lo]!) * frac;
  }
  return out;
}

/**
 * Encodes mono float PCM as a 44-byte-header RIFF/WAVE file of signed 16-bit
 * little-endian samples. Typed over a plain `ArrayBuffer` so it is a valid fetch body.
 */
export function encodeWav16(pcm: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** A half-open sample range `[from, to)` of the resampled audio and its position in milliseconds. */
export interface ChunkRange {
  seq: number;
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

/**
 * Splits `totalSamples` into contiguous ranges of `chunkSeconds`; the last one
 * may be short. Empty audio yields no ranges.
 */
export function chunkRanges(totalSamples: number, rate: number, chunkSeconds: number): ChunkRange[] {
  const size = Math.max(1, Math.round(rate * chunkSeconds));
  const ranges: ChunkRange[] = [];
  for (let from = 0, seq = 0; from < totalSamples; from += size, seq++) {
    const to = Math.min(from + size, totalSamples);
    ranges.push({
      seq,
      from,
      to,
      startMs: Math.round((from * 1000) / rate),
      endMs: Math.round((to * 1000) / rate),
    });
  }
  return ranges;
}
