import { describe, expect, it } from "vitest";
import { clusterBeliefs, cosine, isAmbiguous, selectGroups, spanOverlap, type BeliefItem } from "../group";

const item = (reader: string, belief: string, embedding: number[]): BeliefItem => ({
  reader, reader_name: reader, belief, category: "efficacy", quote: "", span: null, visual: null, embedding,
});

describe("group", () => {
  it("computes cosine", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it("clusters near-identical embeddings and separates distant ones", () => {
    const groups = clusterBeliefs([
      item("a", "guaranteed in a week", [1, 0.05, 0]),
      item("b", "results within 7 days", [1, 0, 0.05]),
      item("c", "doctors recommend it", [0, 1, 0]),
      item("a", "fast results", [0.98, 0.1, 0]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].readerIds.sort()).toEqual(["a", "b"]); // distinct readers
  });

  it("respects the 0.82 threshold", () => {
    const a = [1, 0], b = [Math.cos(0.7), Math.sin(0.7)]; // cos ~0.765
    expect(clusterBeliefs([item("a", "x", a), item("b", "y", b)])).toHaveLength(2);
    expect(clusterBeliefs([item("a", "x", a), item("b", "y", b)], 0.7)).toHaveLength(1);
  });

  it("needs >= 2 distinct readers, and one-reader panels still work", () => {
    const groups = clusterBeliefs([item("a", "x", [1, 0]), item("a", "x2", [1, 0]), item("b", "y", [0, 1]), item("c", "y2", [0, 1])]);
    expect(selectGroups(groups, 6).map((g) => g.readerIds.length)).toEqual([2]);
    expect(selectGroups(clusterBeliefs([item("a", "x", [1, 0])]), 1)).toHaveLength(1);
  });

  it("labels 40-60% splits ambiguous", () => {
    expect(isAmbiguous(3, 6)).toBe(true);
    expect(isAmbiguous(2, 5)).toBe(true);
    expect(isAmbiguous(5, 6)).toBe(false);
    expect(isAmbiguous(2, 6)).toBe(false);
  });
  it("groups paraphrases anchored on the same quote and category, but not other categories", () => {
    const span = { start: 10, end: 40, text: "99.99% Microbe Neutralisation" };
    const a = [1, 0], b = [Math.cos(0.8), Math.sin(0.8)]; // cos ~0.70: below 0.82, above the 0.6 anchored floor
    const anchored = (reader: string, e: number[], category: BeliefItem["category"] = "efficacy") => ({ ...item(reader, "x", e), span, category });
    expect(clusterBeliefs([anchored("a", a), anchored("b", b)])).toHaveLength(1);
    expect(clusterBeliefs([anchored("a", a), anchored("b", b, "health")])).toHaveLength(2);
    expect(clusterBeliefs([item("a", "x", a), item("b", "y", b)])).toHaveLength(2); // no quote, no anchor
    expect(spanOverlap(span, { start: 20, end: 60, text: "" })).toBeCloseTo(2 / 3);
    expect(spanOverlap(span, null)).toBe(0);
  });
});
