import { describe, expect, it } from "vitest";
import { driftFindings, labelPair, type DriftResult } from "../drift";

const s = (strength: number) => ({ belief: "b", quote: "q", strength, readers: 4 });

describe("labelPair", () => {
  it("flags beliefs only the translation creates", () => expect(labelPair({ master: null, variant: s(3) })).toBe("new_belief"));
  it("flags a stronger translated claim", () => expect(labelPair({ master: s(2), variant: s(3) })).toBe("strengthened"));
  it("reports weaker and dropped claims", () => {
    expect(labelPair({ master: s(3), variant: s(1) })).toBe("weakened");
    expect(labelPair({ master: s(2), variant: null })).toBe("dropped");
  });
  it("treats equal strength as the same belief", () => expect(labelPair({ master: s(2), variant: s(2) })).toBe("same"));
});

describe("driftFindings", () => {
  const variant = "Velura विटामिन C सीरम। 4 हफ्तों में पक्का निखार। रोज़ इस्तेमाल के लिए सौम्य।";
  const result: DriftResult = {
    of: 6, model: "m", mode: "cloud", clause: { code: "G-13", title: "Translations keep the claim's strength" },
    rows: [
      { kind: "new_belief", category: "guarantee", master: null, variant: { belief: "The glow is guaranteed", quote: "पक्का निखार", strength: 3, readers: 6 }, explanation: "पक्का means guaranteed.", fix: "निखार दिख सकता है" },
      { kind: "same", category: "health", master: s(2), variant: s(2), explanation: "same" },
      { kind: "weakened", category: "efficacy", master: s(3), variant: s(2), explanation: "weaker" },
    ],
  };

  it("turns only added or strengthened beliefs into findings, located in the translation", () => {
    const f = driftFindings(result, variant, 145, "hi", "m");
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("language_drift");
    expect(f[0].span?.text).toBe("पक्का निखार");
    expect(f[0].citation?.code).toBe("G-13");
    expect(f[0].severity).toBe("high");
    expect(f[0].suggestion?.replacement).toBe("निखार दिख सकता है");
    expect(f[0].suggestion?.source).toBe("translation");
    expect(f[0].title).toContain("Hindi");
  });

  it("keeps the finding but offers no rewrite when the quote cannot be found", () => {
    const f = driftFindings({ ...result, rows: [{ ...result.rows[0], variant: { ...result.rows[0].variant!, quote: "not in the text at all" } }] }, variant, 145, "hi", "m");
    expect(f).toHaveLength(1);
    expect(f[0].span).toBeNull();
    expect(f[0].suggestion).toBeNull();
  });
});

describe("dropped qualifiers", () => {
  it("become a finding when the translation leaves out a disclaimer", () => {
    const f = driftFindings({
      of: 6, model: "m", mode: "cloud", clause: { code: "G-13", title: "t" },
      rows: [{ kind: "dropped", category: "efficacy", master: { belief: "Results vary", quote: "*Results may vary.", strength: 1, readers: 3 }, variant: null, explanation: "" }],
    }, "Velura सीरम।", 145, "hi", "m");
    expect(f).toHaveLength(1);
    expect(f[0].drift_kind).toBe("dropped_qualifier");
    expect(f[0].title).toContain("*Results may vary.");
  });
});
