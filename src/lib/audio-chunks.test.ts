import { describe, expect, it } from "vitest";
import { chunkRanges, downmixResample, encodeWav16 } from "./audio-chunks";

describe("downmixResample", () => {
  it("averages stereo channels into one", () => {
    const left = Float32Array.from([1, 0.5, -1, 0]);
    const right = Float32Array.from([0, 0.5, 1, -0.5]);
    expect(Array.from(downmixResample([left, right], 16000, 16000))).toEqual([0.5, 0.5, 0, -0.25]);
  });

  it("produces round(n * to / from) samples and keeps both endpoints", () => {
    const n = 44100;
    const ramp = Float32Array.from({ length: n }, (_, i) => i / (n - 1));
    const out = downmixResample([ramp], 44100, 16000);
    expect(out.length).toBe(Math.round((n * 16000) / 44100));
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBeCloseTo(1, 6);
    // A linear ramp stays linear under linear interpolation.
    const mid = Math.floor(out.length / 2);
    expect(out[mid]).toBeCloseTo(mid / (out.length - 1), 5);
  });

  it("upsamples by interpolating between neighbours", () => {
    expect(Array.from(downmixResample([Float32Array.from([0, 1])], 8000, 24000))).toEqual(
      [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => expect.closeTo(v, 6)),
    );
  });

  it("returns empty output for empty input", () => {
    expect(downmixResample([new Float32Array(0)], 48000).length).toBe(0);
  });
});

describe("encodeWav16", () => {
  it("writes a 44-byte PCM header with the right sizes and rates", () => {
    const wav = encodeWav16(new Float32Array(10), 16000);
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(wav.length).toBe(44 + 20);
    expect(text(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 20);
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(20);
  });

  it("clamps out-of-range samples to the int16 extremes", () => {
    const wav = encodeWav16(Float32Array.from([2, -3, 1, -1, 0]), 16000);
    const view = new DataView(wav.buffer);
    const samples = [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([32767, -32768, 32767, -32768, 0]);
  });
});

describe("chunkRanges", () => {
  it("covers every sample contiguously with a short last chunk", () => {
    const ranges = chunkRanges(16000 * 10 + 5, 16000, 4);
    expect(ranges.map((r) => [r.seq, r.from, r.to])).toEqual([
      [0, 0, 64000],
      [1, 64000, 128000],
      [2, 128000, 160005],
    ]);
    expect(ranges.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 4000],
      [4000, 8000],
      [8000, 10000],
    ]);
  });

  it("does not emit an empty trailing chunk on an exact multiple", () => {
    const ranges = chunkRanges(16000 * 8, 16000, 4);
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toEqual({ seq: 1, from: 64000, to: 128000, startMs: 4000, endMs: 8000 });
  });

  it("returns one chunk for audio shorter than a chunk and none for no audio", () => {
    expect(chunkRanges(100, 16000, 240)).toEqual([{ seq: 0, from: 0, to: 100, startMs: 0, endMs: 6 }]);
    expect(chunkRanges(0, 16000, 240)).toEqual([]);
  });
});
