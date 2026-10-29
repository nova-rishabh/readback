import { describe, expect, it } from "vitest";
import { computeMetrics, majority, wilson, type BenchCase, type BenchRow } from "../metrics";

const c = (id: string, outcome: BenchCase["outcome"], grounds: string[] = ["unsubstantiated"]): BenchCase => ({
  id, advertiser: "a", product: "p", category: "skincare", medium: "digital", claim_text: "x", outcome, grounds, ruling_summary: "", source_url: "", date: "",
});
const r = (id: string, outcome: BenchRow["outcome"], runs: (boolean | null)[], baseline: boolean): BenchRow => ({
  id, outcome, runs, readback: majority(runs), baseline, beliefs: [], ms: 0,
});

describe("bench metrics", () => {
  it("takes the majority of successful runs, ties flag", () => {
    expect(majority([true, false, true])).toBe(true);
    expect(majority([false, false, true])).toBe(false);
    expect(majority([true, false, null])).toBe(true);
    expect(majority([null, null])).toBeNull();
  });

  it("gives a Wilson interval that contains the rate", () => {
    const w = wilson(11, 13);
    expect(w.rate).toBeCloseTo(0.846, 2);
    expect(w.lo!).toBeLessThan(w.rate!);
    expect(w.hi!).toBeGreaterThan(w.rate!);
    expect(wilson(0, 0).rate).toBeNull();
  });

  it("computes recall, false alarms, precision, stability and per-ground recall", () => {
    const cases = [c("A", "upheld", ["exaggeration"]), c("B", "upheld"), c("C", "not_upheld"), c("D", "not_upheld")];
    const rows = [r("A", "upheld", [true, true, true], true), r("B", "upheld", [false, true, false], true), r("C", "not_upheld", [true, true, false], false), r("D", "not_upheld", [false, false, false], true)];
    const m = computeMetrics(rows, cases);
    expect(m.readback.recall.rate).toBe(0.5);
    expect(m.readback.false_alarm.rate).toBe(0.5);
    expect(m.readback.precision.rate).toBe(0.5);
    expect(m.readback.stability.rate).toBe(0.5); // A and D agree on every run
    expect(m.baseline.recall.rate).toBe(1);
    expect(m.byGround.find((g) => g.ground === "exaggeration")?.readback.rate).toBe(1);
  });
});
