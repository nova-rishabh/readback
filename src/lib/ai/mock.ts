// Deterministic offline stand-in for every model call: regex-cue readers, judge, fixes, vision and embeddings.
import type { BeliefCategory, Persona, ReaderResult } from "../types";
import { PUSHY_RX } from "./tone";

export const sleep = (ms: number) => (process.env.READBACK_MOCK_FAST === "1" ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

type MockVerdict = "supported" | "contradicted" | "unsupported";

interface Cue {
  id: string;
  rx: RegExp;
  belief: string;
  category: BeliefCategory;
  miss: number[]; // panel indexes that do not form this belief (so counts like 5 of 6 emerge)
  verdict: MockVerdict;
  fact: string | null;
  reason: string;
  visual?: string;
  fix: string;
}

export const CUES: Cue[] = [
  {
    id: "guarantee",
    rx: /\b(?:visible\s+)?(?:glow|results?|difference|improvement)\s+(?:in|within)\s+\d+\s*(?:days?|hours?)\b|\bovernight\b|\binstant(?:ly)?\b|\bguarantee[d]?\b/i,
    belief: "Visible results are guaranteed within 7 days",
    category: "guarantee",
    miss: [2],
    verdict: "contradicted",
    fact: "F-07",
    reason: "The ledger supports 71% of users seeing more radiant skin at week 4, not a guaranteed result within 7 days.",
    fix: "71% saw more radiant skin in 4 weeks*",
  },
  {
    id: "endorse",
    rx: /\bdermatologist[- ]?(?:loved|approved|recommended|backed)\b|\bdoctors?\s+(?:recommend|love|trust|endorse)\w*|\bclinically\s+proven\b/i,
    belief: "Dermatologists endorse and recommend this product",
    category: "endorsement",
    miss: [1, 4],
    verdict: "unsupported",
    fact: "F-03",
    reason: "The closest fact, F-03, only says the product was dermatologist-tested; nothing in the ledger says dermatologists recommend it.",
    visual: "model in a white lab coat",
    fix: "Dermatologist-tested",
  },
  {
    id: "natural",
    rx: /\b100\s*%\s*natural(?:,?\s*(?:and\s+)?zero\s+chemicals?)?|\bzero\s+chemicals?\b|\bchemical[- ]free\b|\ball[- ]natural\b/i,
    belief: "The product is 100% natural and contains no chemicals",
    category: "environment",
    miss: [3],
    verdict: "contradicted",
    fact: "F-12",
    reason: "F-12 states 92% naturally derived ingredients (ISO 16128), so 100% natural and zero chemicals overstate it.",
    visual: "green leaves",
    fix: "92% naturally derived ingredients",
  },
  {
    id: "radiant",
    rx: /\b\d+\s*%\s*saw\b[^.]*?\b(?:radiant|glow)[^.]*/i,
    belief: "Most users saw more radiant skin within about 4 weeks",
    category: "efficacy",
    miss: [],
    verdict: "supported",
    fact: "F-07",
    reason: "Matches F-07.",
    fix: "",
  },
  {
    id: "price",
    rx: /\b(?:flat\s+)?\d+\s*%\s*off\b|\bfree\s+shipping\b|\bbest\s+price\b/i,
    belief: "There is a special discount or price offer",
    category: "price",
    miss: [4],
    verdict: "unsupported",
    fact: null,
    reason: "No fact in the ledger covers this offer.",
    fix: "an introductory offer",
  },
  {
    id: "comparison",
    rx: /\b(?:the\s+)?(?:best|#1|number one)\b|\bbetter than\b/i,
    belief: "The product is better than competing products",
    category: "comparison",
    miss: [0],
    verdict: "unsupported",
    fact: null,
    reason: "No fact in the ledger supports a comparison.",
    fix: "a favourite daily serum",
  },
  {
    id: "health",
    rx: /\b(?:cures?|treats?|heals?|acne[- ]free|removes?\s+(?:wrinkles|scars))\b/i,
    belief: "The product treats a skin condition",
    category: "health",
    miss: [],
    verdict: "unsupported",
    fact: null,
    reason: "No fact in the ledger supports a treatment claim.",
    fix: "supports healthier-looking skin",
  },
];

export function detect(text: string) {
  return CUES.flatMap((cue) => {
    const m = text.match(cue.rx);
    return m && m.index !== undefined ? [{ cue, quote: m[0].trim(), index: m.index }] : [];
  });
}

export function mockEmbed(text: string): number[] {
  const v = new Array(128).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}%]+/gu) ?? []) {
    let h = 5381;
    for (const ch of w) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
    v[h % 128] += 1;
  }
  return v;
}

export function mockJudge(statement: string) {
  const c = CUES.find((x) => x.belief === statement);
  return c
    ? { verdict: c.verdict, fact_code: c.fact, reason: c.reason }
    : { verdict: "unsupported" as MockVerdict, fact_code: null, reason: "No fact in the ledger covers this claim." };
}

export function mockTone(text: string, idx: number): string[] {
  const hits = detect(text).filter((d) => d.cue.verdict !== "supported");
  if (PUSHY_RX.test(text)) return idx === 4 ? ["direct"] : idx === 5 ? ["pushy", "exaggerated"] : ["pushy", "salesy"];
  return hits.length ? ["confident"] : ["calm", "informative"];
}

export function mockBeliefs(text: string, idx: number, hasImage: boolean): ReaderResult["beliefs"] {
  return detect(text)
    .filter((d) => !d.cue.miss.includes(idx))
    .map((d) => ({
      belief: d.cue.belief,
      trigger_quote: d.quote,
      visual_element: hasImage && d.cue.visual && idx % 2 === 0 ? d.cue.visual : null,
      category: d.cue.category,
      confidence: Math.round((0.95 - idx * 0.05) * 100) / 100,
      grounded: false,
    }));
}

export async function mockReader(p: Persona, idx: number, c: { text: string; intent: string; image: unknown }): Promise<ReaderResult> {
  await sleep(350 + idx * 300);
  const beliefs = mockBeliefs(c.text, idx, !!c.image);
  const claims = beliefs.filter((b) => b.category !== "efficacy");
  return {
    persona_id: p.id,
    persona_name: p.name,
    takeaway: beliefs.length ? `Reads as a skincare product that ${beliefs.map((b) => b.belief.toLowerCase()).slice(0, 2).join("; ")}.` : "Reads as a plain product post with no strong claims.",
    tone: mockTone(c.text, idx),
    intent_match: !(idx === 3 && claims.length >= 2),
    beliefs,
  };
}

export function mockFix(belief: string | null, spanText: string) {
  const c = belief ? CUES.find((x) => x.belief === belief) : null;
  const replacement = c?.fix || (PUSHY_RX.test(spanText) ? "Explore the serum" : spanText);
  return {
    replacement,
    rationale: c
      ? `Replaces the unsupported wording with what the ledger allows${c.fact ? ` (${c.fact})` : ""}.`
      : "Keeps the call to action but removes the urgency.",
  };
}

export function mockReread(text: string, panelSize: number, flagged: string[]) {
  return Array.from({ length: panelSize }, (_, idx) => ({
    persona: String(idx),
    intent_match: true,
    tone: mockTone(text, idx),
    beliefs: detect(text)
      .filter((d) => !d.cue.miss.includes(idx))
      .map((d) => ({
        belief: d.cue.belief,
        category: d.cue.category,
        verdict: d.cue.verdict === "supported" ? ("ok" as const) : d.cue.verdict,
        matches_flagged: flagged.indexOf(d.cue.belief) >= 0 ? flagged.indexOf(d.cue.belief) : null,
      })),
  }));
}

export const mockBoxes = () => [{ text: "Visible glow in 7 days", box: [0.1, 0.46, 0.8, 0.09] as [number, number, number, number] }];
export const mockConfirmVisual = (el: string) => /lab coat|coat|leaf|leaves|model|green/i.test(el);
