import { describe, expect, it } from "vitest";
import { levenshteinRatio, locateQuote, normalize, tokenOverlap } from "../grounding";

const DRAFT = "Dermatologist-loved Vitamin C serum. Visible glow in 7 days. 100% natural, zero chemicals. Shop now";

describe("grounding", () => {
  it("normalizes case and punctuation", () => {
    expect(normalize("100% Natural, ZERO chemicals!")).toBe("100% natural zero chemicals");
  });

  it("finds an exact quote with correct offsets", () => {
    const s = locateQuote(DRAFT, "Visible glow in 7 days")!;
    expect(s.text).toBe("Visible glow in 7 days");
    expect(DRAFT.slice(s.start, s.end)).toBe(s.text);
    expect(s.score).toBe(1);
  });

  it("is case and punctuation insensitive", () => {
    expect(locateQuote(DRAFT, "100% NATURAL zero chemicals")?.text).toBe("100% natural, zero chemicals");
  });

  it("tolerates a small paraphrase (token overlap >= 0.8)", () => {
    const s = locateQuote(DRAFT, "visible glow within 7 days")!;
    expect(s.text).toBe("Visible glow in 7 days");
  });

  it("rejects quotes that are not in the draft", () => {
    expect(locateQuote(DRAFT, "clinically proven to cure acne")).toBeNull();
    expect(locateQuote(DRAFT, "")).toBeNull();
  });

  it("scores helpers", () => {
    expect(tokenOverlap(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "x"])).toBe(0.8);
    expect(levenshteinRatio("kitten", "kitten")).toBe(1);
    expect(levenshteinRatio("abc", "xyz")).toBe(0);
  });
  it("keeps Indic vowel signs inside the span", () => {
    const hi = "Velura Vitamin C सीरम। 4 हफ्तों में पक्का निखार।";
    expect(locateQuote(hi, "पक्का निखार")?.text).toBe("पक्का निखार");
    const ta = "நான்கு வாரங்களில் நிச்சயம் பொலிவு";
    expect(locateQuote(ta, "நிச்சயம் பொலிவு")?.text).toBe("நிச்சயம் பொலிவு");
  });
});
