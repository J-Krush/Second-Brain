import { describe, expect, it } from "vitest";
import { canonicalUrl } from "./link-url";

describe("canonicalUrl", () => {
  it("collapses the YouTube share forms onto watch?v=", () => {
    expect(canonicalUrl("https://youtu.be/dQw4w9WgXcQ?si=abc123")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(canonicalUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&t=42")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(canonicalUrl("https://www.youtube.com/shorts/abc_-123?si=x")).toBe(
      "https://www.youtube.com/watch?v=abc_-123",
    );
  });

  it("strips tracking params but keeps meaningful ones", () => {
    expect(canonicalUrl("https://www.instagram.com/reel/C1a2b3/?igsh=MzRlODBiNWFlZA==&utm_source=ig")).toBe(
      "https://www.instagram.com/reel/C1a2b3",
    );
    expect(canonicalUrl("https://example.com/search?q=brain&page=2#top")).toBe(
      "https://example.com/search?q=brain&page=2",
    );
  });

  it("leaves non-http and junk alone", () => {
    expect(canonicalUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(canonicalUrl("not a url")).toBe("not a url");
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com/");
  });
});
