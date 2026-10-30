// Tests: Aho-Corasick, contrast math, ΔE2000 (Sharma reference data), runRules incl. a synthetic sharp image.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AhoCorasick } from "../aho-corasick";
import { contrastRatio, deltaE2000, hexToRgb, relativeLuminance, rgbToLab } from "../color";
import { kmeans } from "../pixels";
import { runRules } from "../index";
import type { BrandSpace } from "@/lib/types";

describe("AhoCorasick", () => {
  it("finds overlapping patterns with spans", () => {
    const ac = new AhoCorasick(["he", "she", "his", "hers"]);
    const got = ac.search("ushers").map((m) => [m.pattern, m.start, m.end]);
    // "he" and "hers" need a boundary on both sides, so none of these sit on word edges inside "ushers"
    expect(got).toEqual([]);
    const got2 = ac.search("she said hers").map((m) => [m.pattern, m.start, m.end]);
    expect(got2).toEqual([["she", 0, 3], ["hers", 9, 13]]);
  });

  it("matches overlapping multi-word phrases, case-insensitively", () => {
    const ac = new AhoCorasick(["zero chemicals", "chemicals", "chemical-free"]);
    const text = "100% natural, ZERO Chemicals. Truly Chemical-Free!";
    const m = ac.search(text);
    expect(m.map((x) => text.slice(x.start, x.end))).toEqual(["ZERO Chemicals", "Chemicals", "Chemical-Free"]);
  });

  it("respects word boundaries", () => {
    const ac = new AhoCorasick(["cure"]);
    expect(ac.search("secure procure cured")).toEqual([]);
    expect(ac.search("a cure.")).toHaveLength(1);
  });

  it("allows non-word edges like '% saw'", () => {
    const ac = new AhoCorasick(["% saw"]);
    expect(ac.search("71% saw glow")).toHaveLength(1);
  });
});

describe("colour math", () => {
  it("contrast #777 on #fff is about 4.48", () => {
    expect(contrastRatio(hexToRgb("#777777"), hexToRgb("#ffffff"))).toBeCloseTo(4.48, 2);
  });
  it("luminance bounds and black/white = 21", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });
  it("rgbToLab white and black", () => {
    const w = rgbToLab([255, 255, 255]);
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1])).toBeLessThan(0.05);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 3);
  });

  // Sharma, Wu, Dalal (2005) test data
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it.each(pairs)("ΔE2000 %j vs %j = %f", (a, b, want) => {
    expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
    expect(deltaE2000(b, a)).toBeCloseTo(want, 3); // symmetric
  });
  it("identical colours give 0", () => expect(deltaE2000([50, 10, 10], [50, 10, 10])).toBe(0));
});

describe("kmeans", () => {
  it("is deterministic and splits two colours", () => {
    const pts = [...Array(30).fill([255, 255, 255]), ...Array(5).fill([10, 10, 10])] as [number, number, number][];
    const a = kmeans(pts, 2);
    expect(kmeans(pts, 2)).toEqual(a);
    expect(a.map((c) => c.size).sort((x, y) => x - y)).toEqual([5, 30]);
  });
});

const brand: BrandSpace = {
  id: "b", name: "Velura", voice_traits: [],
  palette: [{ name: "Leaf", hex: "#2F6B3F" }, { name: "Cream", hex: "#F7F4EE" }],
  clauses: [{ id: "c1", code: "G-12", title: "No absolute claims", body: "", kind: "rule", confirmed: true }],
  facts: [], personas: [],
  terms: [
    { id: "1", kind: "banned", phrase: "zero chemicals", replacement: "92% naturally derived ingredients", clause_code: "G-12" },
    { id: "2", kind: "banned", phrase: "chemicals", replacement: null, clause_code: "G-12" },
    { id: "3", kind: "embargo", phrase: "Velura Nightshift", replacement: null, clause_code: "G-30" },
    { id: "4", kind: "disclaimer", phrase: "*Results may vary", replacement: null, clause_code: "G-20", triggers: ["results", "visible", "% saw"] },
  ],
};

describe("runRules text", () => {
  it("flags banned, embargo and missing disclaimer with stable ids and citations", async () => {
    const text = "Visible glow in 7 days. Zero chemicals. Try Velura Nightshift";
    const f = await runRules({ text, brand, channel: "instagram" });
    const ids = f.map((x) => x.id).sort();
    expect(ids).toEqual(["rule-disclaimer-0", "rule-embargo-44-61", "rule-banned-24-38"].sort());
    const banned = f.find((x) => x.category === "terminology")!;
    expect(banned.engine).toBe("rule");
    expect(banned.severity).toBe("high");
    expect(banned.span?.text).toBe("Zero chemicals");
    expect(banned.citation).toEqual({ kind: "clause", code: "G-12", text: "No absolute claims" });
    expect(banned.suggestion).toEqual({ replacement: "92% naturally derived ingredients", rationale: expect.any(String), reread: null });
    expect(f.find((x) => x.category === "embargo")!.severity).toBe("high");
  });

  it("does not flag the disclaimer when present", async () => {
    const f = await runRules({ text: "Visible glow. *Results may vary", brand, channel: "website" });
    expect(f.find((x) => x.category === "disclaimer")).toBeUndefined();
  });

  it("is deterministic", async () => {
    const input = { text: "Zero chemicals, visible results", brand, channel: "email" as const };
    expect(await runRules(input)).toEqual(await runRules(input));
  });
});

/** 400x200 white image with a flat rectangle of `color` standing in for text pixels. */
async function synth(color: [number, number, number], rect: { x: number; y: number; w: number; h: number }) {
  const W = 400, H = 200;
  const raw = Buffer.alloc(W * H * 3, 255);
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) raw.set(color, (y * W + x) * 3);
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

describe("runRules image", () => {
  it("flags a known low-contrast text box (WCAG 1.4.3) and passes a high-contrast one", async () => {
    // #AAAAAA on white = 2.32:1. Box 0.2,0.4 -> 80..280 x 80..92 px (height 0.06 = small text)
    const image = await synth([170, 170, 170], { x: 100, y: 83, w: 80, h: 6 });
    const f = await runRules({
      text: "Visible glow in 7 days", image, imageAlt: "A bottle of serum", brand, channel: "instagram",
      textBoxes: [{ text: "Visible glow", box: [0.2, 0.4, 0.5, 0.06] }, { text: "Elsewhere", box: [0.0, 0.9, 0.3, 0.05] }],
    });
    const c = f.find((x) => x.category === "accessibility")!;
    expect(c).toBeDefined();
    expect(c.citation).toEqual({ kind: "wcag", code: "1.4.3", text: expect.any(String) });
    expect(c.measured?.required).toBe(4.5);
    expect(c.measured?.ratio).toBeCloseTo(2.32, 1);
    expect(c.measured?.fg).toBe("#AAAAAA");
    expect(c.measured?.bg).toBe("#FFFFFF");
    expect(c.span?.text).toBe("Visible glow");
    expect(f.filter((x) => x.category === "accessibility")).toHaveLength(1); // flat white box is skipped
  });

  it("uses the 3:1 threshold for large text", async () => {
    const image = await synth([119, 119, 119], { x: 100, y: 30, w: 100, h: 40 }); // #777 = 4.48
    const f = await runRules({
      text: "x", image, imageAlt: "alt text", brand: { ...brand, palette: [] }, channel: "other",
      textBoxes: [{ text: "x", box: [0.2, 0.1, 0.5, 0.3] }],
    });
    expect(f.filter((x) => x.category === "accessibility")).toHaveLength(0);
  });

  it("flags missing and filename alt text (WCAG 1.1.1)", async () => {
    const image = await synth([0, 0, 0], { x: 0, y: 0, w: 1, h: 1 });
    for (const alt of [null, "  ", "IMG_2043.jpg"]) {
      const f = await runRules({ text: "hi", image, imageAlt: alt, brand: { ...brand, palette: [] }, channel: "other" });
      const a = f.find((x) => x.id === "rule-accessibility-alt");
      expect(a?.citation?.code).toBe("1.1.1");
    }
    const ok = await runRules({ text: "hi", image, imageAlt: "Model holding serum", brand: { ...brand, palette: [] }, channel: "other" });
    expect(ok.find((x) => x.id === "rule-accessibility-alt")).toBeUndefined();
  });

  it("flags a large off-palette colour as low severity", async () => {
    // big saturated purple block, palette is green/cream
    const image = await synth([128, 0, 200], { x: 0, y: 0, w: 400, h: 120 });
    const f = await runRules({ text: "hi", image, imageAlt: "alt", brand, channel: "other" });
    const v = f.filter((x) => x.category === "visual");
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].severity).toBe("low");
    expect(v[0].measured?.delta_e).toBeGreaterThan(20);
  });
});

describe("medical claims", () => {
  it("are caught by code on every draft", async () => {
    const { runRules } = await import("../index");
    const brand = { terms: [], clauses: [], palette: [], facts: [{ id: "f", code: "F-16", statement: "Velura is a cosmetic, not a medicine.", source: "", owner: "", expires_on: null, version: 1, status: "active" }] } as never;
    const f = await runRules({ text: "Cures acne overnight, 100% guaranteed. Also heals eczema.", brand, channel: "instagram" });
    const med = f.filter((x) => x.id.startsWith("rule-medical"));
    expect(med.map((x) => x.span?.text)).toEqual(["Cures acne", "heals eczema"]);
    expect(med[0].citation?.code).toBe("F-16");
    expect((await runRules({ text: "Gentle on skin, made for daily use.", brand, channel: "instagram" })).length).toBe(0);
  });
});

describe("banned-term fixes in context", () => {
  it("replace an intensifier with the term, so the sentence still reads", async () => {
    const { runRules } = await import("../index");
    const brand = { terms: [{ id: "t", kind: "banned", phrase: "guaranteed", replacement: "designed to support", clause_code: null }], clauses: [], palette: [], facts: [] } as never;
    const [f] = await runRules({ text: "Glow, 100% guaranteed.", brand, channel: "instagram" });
    expect(f.span?.text).toBe("100% guaranteed");
    expect(f.suggestion?.replacement).toBe("designed to support");
  });
});
