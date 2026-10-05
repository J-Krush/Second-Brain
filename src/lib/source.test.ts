import { describe, expect, it } from "vitest";
import { parseSourceKey, sourceKey, sourceLabel, sourceOf } from "./source";

describe("sourceOf", () => {
  it("prefers a valid props.source over the url", () => {
    const s = sourceOf({
      props: { source: { via: "book", author: "Seneca", work: "Letters", page: "12" } },
      url: "https://example.com/x",
    });
    expect(s).toEqual({ via: "book", author: "Seneca", work: "Letters", page: "12" });
  });

  it("ignores junk props.source and falls back to the url domain", () => {
    for (const junk of [{ via: "carrier-pigeon" }, { via: "web" }, { via: "upload", filename: 3 }, "web", 42]) {
      expect(sourceOf({ props: { source: junk }, url: "https://www.example.com/a?b=1" })).toEqual({
        via: "web",
        domain: "example.com",
      });
    }
  });

  it("falls back to typed when there is no source and no parseable url", () => {
    expect(sourceOf({ props: {}, url: null })).toEqual({ via: "typed" });
    expect(sourceOf({ props: null, url: "not a url" })).toEqual({ via: "typed" });
    expect(sourceOf({ props: { source: { via: "nope" } }, url: null })).toEqual({ via: "typed" });
  });
});

describe("sourceLabel", () => {
  it("formats book citations with whatever parts exist", () => {
    expect(sourceLabel({ via: "book", author: "Seneca", work: "Letters", page: "12" })).toBe("Seneca, Letters p.12");
    expect(sourceLabel({ via: "book", work: "Letters" })).toBe("Letters");
    expect(sourceLabel({ via: "book", page: "3" })).toBe("book p.3");
  });
});

describe("source facet keys", () => {
  it("round-trips web domains and plain channels", () => {
    expect(parseSourceKey(sourceKey({ via: "web", domain: "a.example.com" }))).toEqual({ via: "web", domain: "a.example.com" });
    expect(parseSourceKey(sourceKey({ via: "book", author: "Seneca" }))).toEqual({ via: "book" });
    expect(parseSourceKey(sourceKey({ via: "upload", filename: "x.pdf" }))).toEqual({ via: "upload" });
  });

  it("rejects unknown channels and empty domains from the URL", () => {
    expect(parseSourceKey("web:")).toBeNull();
    expect(parseSourceKey("carrier-pigeon")).toBeNull();
    expect(parseSourceKey("")).toBeNull();
  });
});
