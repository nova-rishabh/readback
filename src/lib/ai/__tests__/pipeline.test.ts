import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BrandSpace, CheckEvent } from "../../types";

vi.mock("@/lib/privacy/gate", () => ({
  mask: (t: string) => ({ masked: t, tokens: new Map(), count: 0 }),
  unmask: (t: string) => t,
}));
vi.mock("@/lib/rules", () => ({ runRules: async () => [] }));
vi.mock("@/lib/db/queries", () => ({ matchFacts: async () => { throw new Error("db offline"); } }));

const fact = (code: string, statement: string) => ({
  id: code, code, statement, source: "test", owner: "qa", expires_on: null, version: 1, status: "active" as const,
});
const persona = (id: string, name: string) => ({ id, name, description: name, lang: "en" as const, builtin: false });

const brand: BrandSpace = {
  id: "b1", name: "Velura", voice_traits: ["warm", "evidence-led", "never pushy"], palette: [], clauses: [], terms: [],
  facts: [
    fact("F-03", "Dermatologist-tested"),
    fact("F-07", "71% saw more radiant skin at week 4"),
    fact("F-12", "92% naturally derived ingredients (ISO 16128)"),
  ],
  personas: [persona("p1", "Urban working woman"), persona("p2", "College student"), persona("p3", "Skin-concern 35+")],
};

const TEXT = "Dermatologist-loved Vitamin C serum. Visible glow in 7 days. 100% natural, zero chemicals. Shop now";

let runCheck: typeof import("../pipeline").runCheck;
beforeAll(async () => {
  vi.stubEnv("READBACK_MOCK_AI", "1");
  vi.stubEnv("READBACK_MOCK_FAST", "1");
  ({ runCheck } = await import("../pipeline"));
});

const input = (text = TEXT, lockedPhrases = ["Vitamin C serum"]) => ({
  text, intent: "A Vitamin C serum that brightens skin", lang: "en" as const, channel: "instagram" as const,
  image: null, imageAlt: null, lockedPhrases, brand,
});

describe("runCheck (mock mode)", () => {
  it("produces the Velura #142 demo result", async () => {
    const events: CheckEvent[] = [];
    const r = await runCheck(input(), (e) => events.push(e));

    expect(r.summary.mode).toBe("mock");
    expect(r.readers).toHaveLength(6);
    expect(events.filter((e) => e.type === "reader")).toHaveLength(6);

    const claims = r.findings.filter((f) => f.category === "claim");
    const by = (code: string) => claims.find((f) => f.belief?.fact_code === code)!;
    expect(claims).toHaveLength(3);
    expect(by("F-07").belief?.verdict).toBe("contradicted");
    expect(by("F-03").belief?.verdict).toBe("unsupported");
    expect(by("F-12").belief?.verdict).toBe("contradicted");
    expect(by("F-07").span?.text).toBe("Visible glow in 7 days");
    expect(by("F-07").suggestion?.replacement).toBe("71% saw more radiant skin in 4 weeks*");

    const tone = r.findings.find((f) => f.category === "tone")!;
    expect(tone.title).toMatch(/pushy/);
    expect(tone.span?.text).toBe("Shop now");

    for (const f of [...claims, tone]) expect(f.suggestion?.reread?.passed).toBe(true);
    for (const f of claims) expect(f.suggestion!.reread!.unsupported_after).toBeLessThan(f.suggestion!.reread!.unsupported_before);
    expect(events.filter((e) => e.type === "suggestion")).toHaveLength(4);
    expect(events.map((e) => e.type)).toContain("summary");
    expect(events.at(-1)?.type).toBe("summary");
  });

  it("never edits locked phrases", async () => {
    const r = await runCheck(input(TEXT, ["Visible glow in 7 days"]), () => {});
    const f = r.findings.find((x) => x.belief?.fact_code === "F-07");
    expect(f?.suggestion).toBeNull();
  });

  it("derives cue beliefs for other texts and stays quiet on clean copy", async () => {
    const r = await runCheck(input("Best serum ever. Flat 30% off today"), () => {});
    expect(r.findings.some((f) => f.belief?.category === "comparison")).toBe(true);
    const clean = await runCheck(input("A gentle vitamin C serum for daily use."), () => {});
    expect(clean.findings).toHaveLength(0);
  });

  it("replays events from the cache", async () => {
    const a: CheckEvent[] = [], b: CheckEvent[] = [];
    await runCheck(input("Cached copy. Guaranteed glow"), (e) => a.push(e));
    await runCheck(input("Cached copy. Guaranteed glow"), (e) => b.push(e));
    expect(b).toEqual(a);
  });
});
