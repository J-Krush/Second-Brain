import { describe, expect, it } from "vitest";
import { groupCaptionEvents, youtubeVideoId } from "./youtube";

describe("youtubeVideoId", () => {
  it("extracts the id from every URL shape YouTube shares", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=xyz&t=10",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?start=5",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
    ]) {
      expect(youtubeVideoId(url), url).toBe("dQw4w9WgXcQ");
    }
  });

  it("rejects other hosts, malformed ids, and non-video pages", () => {
    for (const url of [
      null,
      undefined,
      "",
      "not a url",
      "https://vimeo.com/watch?v=dQw4w9WgXcQ",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQextra",
      "https://youtu.be/abc",
      "https://www.youtube.com/channel/UCdQw4w9WgXcQ",
      "https://www.youtube.com/watch",
      "ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(youtubeVideoId(url), String(url)).toBeNull();
    }
  });
});

describe("groupCaptionEvents", () => {
  it("drops events without segs or with only whitespace", () => {
    const chunks = groupCaptionEvents([
      { tStartMs: 0, dDurationMs: 100000 },
      { tStartMs: 500, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "hello" }, { utf8: " world" }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "  " }] },
    ]);
    expect(chunks).toEqual([{ seq: 0, startMs: 1000, endMs: 3000, text: "hello world" }]);
  });

  it("collapses newlines and runs of whitespace inside and across segs", () => {
    const [chunk] = groupCaptionEvents([
      { tStartMs: 0, dDurationMs: 10, segs: [{ utf8: "line one\nline" }, { utf8: "\n two  " }] },
    ]);
    expect(chunk?.text).toBe("line one line two");
  });

  it("breaks into chunks at event boundaries without exceeding maxChars", () => {
    const events = [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "aaaa" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "bbbb" }] },
      { tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: "cccc" }] },
      { tStartMs: 4000, segs: [{ utf8: "dd" }] },
    ];
    // "aaaa bbbb" is 9 chars; adding " cccc" would make 14 > 10.
    expect(groupCaptionEvents(events, 10)).toEqual([
      { seq: 0, startMs: 0, endMs: 2000, text: "aaaa bbbb" },
      { seq: 1, startMs: 2000, endMs: 4000, text: "cccc dd" },
    ]);
  });

  it("keeps an over-long single event whole as its own chunk", () => {
    const long = "x".repeat(25);
    const chunks = groupCaptionEvents(
      [
        { tStartMs: 0, dDurationMs: 100, segs: [{ utf8: "hi" }] },
        { tStartMs: 100, dDurationMs: 100, segs: [{ utf8: long }] },
        { tStartMs: 200, dDurationMs: 100, segs: [{ utf8: "yo" }] },
      ],
      10,
    );
    expect(chunks.map((c) => c.text)).toEqual(["hi", long, "yo"]);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
  });

  it("returns no chunks when nothing has text", () => {
    expect(groupCaptionEvents([{ tStartMs: 0 }, { tStartMs: 1, segs: [] }])).toEqual([]);
  });
});
