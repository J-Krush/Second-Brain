import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./rrf";

interface Item {
  id: string;
  score: number;
}
function item(id: string): Item {
  return { id, score: 0 };
}

describe("reciprocalRankFusion", () => {
  it("ranks an item found near the top of both lists above single-list items", () => {
    const list1 = [item("A"), item("B")];
    const list2 = [item("A"), item("C")];
    const fused = reciprocalRankFusion([list1, list2]);
    expect(fused[0]!.id).toBe("A");
    expect(fused.map((h) => h.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("scores by summed 1/(k+rank+1) with k=60", () => {
    const fused = reciprocalRankFusion([
      [item("A"), item("B")],
      [item("B"), item("A")],
    ]);
    expect(fused).toHaveLength(2);
    expect(fused[0]!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused[1]!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("an item in both lists outranks a single-list item", () => {
    const fused = reciprocalRankFusion([
      [item("X"), item("Z")],
      [item("Y"), item("X")],
    ]);
    const ids = fused.map((h) => h.id);
    expect(ids.indexOf("X")).toBeLessThan(ids.indexOf("Z"));
  });

  it("deduplicates ids across lists into one entry", () => {
    const fused = reciprocalRankFusion([[item("A")], [item("A")], [item("A")]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(3 / 61, 10);
  });
});
