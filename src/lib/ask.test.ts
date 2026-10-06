import { describe, expect, it } from "vitest";
import { buildMessages, parseCitations, toSource } from "./ask";

const hit = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "thought",
  title: null,
  body: "first line\n\n\n\n   spaced    out  ",
  url: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  score: 0.5,
};

describe("parseCitations", () => {
  it("returns distinct indexes in order of first appearance", () => {
    expect(parseCitations("a [2] b [1] c [2] d [3]", 3)).toEqual([2, 1, 3]);
  });

  it("drops markers outside the source range", () => {
    expect(parseCitations("[0] [4] [1] [12]", 3)).toEqual([1]);
  });

  it("ignores markdown links and non-numeric brackets", () => {
    expect(parseCitations("[link](http://x) [a] [1]", 3)).toEqual([1]);
  });
});

describe("toSource", () => {
  it("collapses runs of spaces and blank lines, numbering from the caller", () => {
    const s = toSource(hit, 3);
    expect(s.index).toBe(3);
    expect(s.excerpt).toBe("first line\n\nspaced out");
  });

  it("falls back to the url when there is no body and caps long excerpts", () => {
    expect(toSource({ ...hit, body: null, url: "https://x.test/p" }, 1).excerpt).toBe("https://x.test/p");
    const long = toSource({ ...hit, body: "x".repeat(2000) }, 1).excerpt;
    expect(long.length).toBe(1501);
    expect(long.endsWith("…")).toBe(true);
    expect(toSource({ ...hit, body: "x".repeat(2000) }, 1, 300).excerpt.length).toBe(301);
  });
});

describe("buildMessages", () => {
  it("numbers passages to match citation indexes and ends with the question", () => {
    const sources = [toSource({ ...hit, title: "Alpha" }, 1), toSource({ ...hit, id: "2", type: "link", url: "https://b.test" }, 2)];
    const [system, user] = buildMessages("why?", sources, "SYS");
    expect(system).toEqual({ role: "system", content: "SYS" });
    expect(user?.content).toContain("[1] · thought · Alpha\n");
    expect(user?.content).toContain("[2] · link · (untitled) · https://b.test\n");
    expect(user?.content.endsWith("Question: why?")).toBe(true);
  });
});
