// Cross-language drift: does a Hindi/Hinglish (or marketplace) variant leave readers with the same beliefs as the
// English master? One structured call reads both versions with the panel and pairs the beliefs; code then labels
// each pair NEW BELIEF / STRENGTHENED CLAIM / WEAKENED / DROPPED / SAME and cites the translation clause.
import { z } from "zod";
import type { BeliefCategory, BrandSpace, Lang } from "../types";
import { panelFor } from "./personas";
import { CATEGORIES } from "./reader";
import { callObject, isMock, MODEL_NAME } from "./provider";
import { clauseFor } from "./verify";

export type DriftKind = "new_belief" | "strengthened" | "weakened" | "dropped" | "same";

export interface DriftRow {
  kind: DriftKind;
  category: BeliefCategory;
  master: { belief: string; quote: string; strength: number; readers: number } | null;
  variant: { belief: string; quote: string; strength: number; readers: number } | null;
  explanation: string;
}

export interface DriftResult {
  rows: DriftRow[];
  of: number;
  model: string;
  mode: "cloud" | "mock";
  clause: { code: string; title: string } | null;
}

const side = z.object({ belief: z.string(), quote: z.string(), strength: z.number(), readers: z.number() });
const schema = z.object({
  pairs: z.array(z.object({ category: z.enum(CATEGORIES), master: side.nullable(), variant: side.nullable(), note: z.string() })),
});

// Strength scale the model uses: 1 = possible/may, 2 = likely/visible, 3 = definite/guaranteed/certain.
const STRENGTH = "strength: 1 = hedged (may, can help), 2 = plain claim (gives, visible), 3 = absolute (guaranteed, pakka, 100%, always).";

export function labelPair(p: { master: DriftRow["master"]; variant: DriftRow["variant"] }): DriftKind {
  if (p.master && !p.variant) return "dropped";
  if (!p.master && p.variant) return "new_belief";
  if (p.master && p.variant) {
    if (p.variant.strength > p.master.strength) return "strengthened";
    if (p.variant.strength < p.master.strength) return "weakened";
  }
  return "same";
}

function mockPairs(master: string, variant: string): z.infer<typeof schema>["pairs"] {
  const absolute = /पक्का|गारंटी|pakka|guarantee|100%|हमेशा/i;
  const time = (s: string) => s.match(/(\d+)\s*(weeks?|days?|हफ्त\S*|दिन)/i)?.[0] ?? "";
  const pairs: z.infer<typeof schema>["pairs"] = [
    {
      category: "efficacy",
      master: { belief: "Skin looks more radiant after a few weeks of use", quote: time(master) || master.slice(0, 40), strength: absolute.test(master) ? 3 : 2, readers: 5 },
      variant: { belief: "Skin glow is certain within the stated weeks", quote: time(variant) || variant.slice(0, 40), strength: absolute.test(variant) ? 3 : 2, readers: 5 },
      note: absolute.test(variant) && !absolute.test(master) ? "The variant adds a word meaning 'guaranteed'." : "Same claim in both.",
    },
  ];
  if (absolute.test(variant) && !absolute.test(master))
    pairs.push({ category: "guarantee", master: null, variant: { belief: "The result is guaranteed", quote: variant.match(absolute)?.[0] ?? "", strength: 3, readers: 6 }, note: "Only the variant promises a guaranteed outcome." });
  return pairs;
}

export async function compareVersions(i: { master: string; variant: string; variantLang: Lang; brand: BrandSpace }): Promise<DriftResult> {
  const panel = panelFor(i.brand);
  const mock = isMock();
  const embargo = i.brand.terms.filter((t) => t.kind === "embargo").map((t) => t.phrase);
  const pairs = mock
    ? mockPairs(i.master, i.variant)
    : (
        await callObject({
          schema,
          system: `You simulate ${panel.length} readers (${panel.map((p) => p.name).join("; ")}) who each read an English master ad and its ${i.variantLang === "hi" ? "Hindi" : "Hinglish"} version. You compare the beliefs each version leaves behind, as a bilingual compliance reviewer would.`,
          prompt: [
            `ENGLISH MASTER:\n"""\n${i.master}\n"""`,
            `${i.variantLang === "hi" ? "HINDI" : "HINGLISH"} VERSION:\n"""\n${i.variant}\n"""`,
            "List every distinct belief a reader forms from either version, including implied ones. Pair the same belief across versions; use null on the side where it does not appear.",
            `For each side give the belief in English, the exact quote from that version that causes it, ${STRENGTH} and readers = how many of the ${panel.length} readers would form it.`,
            "note: one sentence on what changed, naming the translated word when the strength differs (for example a word meaning 'guaranteed').",
          ].join("\n\n"),
          embargo,
          temperature: 0,
        })
      ).pairs;

  const clause = clauseFor(i.brand, "language_drift");
  const rows: DriftRow[] = pairs
    .filter((p) => p.master || p.variant)
    .map((p) => {
      const kind = labelPair(p);
      return { kind, category: p.category, master: p.master, variant: p.variant, explanation: p.note };
    })
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return { rows, of: panel.length, model: mock ? "mock" : MODEL_NAME, mode: mock ? "mock" : "cloud", clause: clause ? { code: clause.code, title: clause.title } : null };
}

const ORDER: DriftKind[] = ["new_belief", "strengthened", "dropped", "weakened", "same"];
