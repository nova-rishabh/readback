import { describe, expect, it } from "vitest";
import type { BrandSpace, ReaderResult } from "@/lib/types";
import { toneFinding } from "../tone";

const reader = (tone: string[]): ReaderResult => ({ persona_id: "p", persona_name: "p", takeaway: "", tone, intent_match: true, beliefs: [] });
const brand = {
  voice_traits: ["warm", "never pushy"],
  clauses: [
    { id: "1", code: "G-02", title: "No miracle language", body: "", kind: "rule", confirmed: true },
    { id: "2", code: "G-11", title: "Voice: warm, evidence-led, never pushy", body: "", kind: "ai", confirmed: true },
  ],
} as unknown as BrandSpace;

describe("toneFinding", () => {
  it("flags a majority pushy reading, marks the call to action and cites the voice clause", () => {
    const f = toneFinding([reader(["pushy"]), reader(["salesy"]), reader(["pushy", "urgent"]), reader(["calm"])], brand, "Glow in 7 days. Shop now", "m")!;
    expect(f.citation?.code).toBe("G-11"); // a regex typo once made this null
    expect(f.span?.text).toBe("Shop now");
  });
  it("stays quiet when most readers find the tone on-brand", () => {
    expect(toneFinding([reader(["pushy"]), reader(["warm"]), reader(["calm"])], brand, "x", "m")).toBeNull();
  });
});
