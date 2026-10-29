// Cross-language drift: does a translated variant (Hindi, Hinglish, Tamil, Marathi) leave readers with the same beliefs
// as the English master? One structured call reads both versions with the panel and pairs the beliefs; code then
// labels each pair NEW BELIEF / STRENGTHENED / WEAKENED / DROPPED / SAME, and turns the flagged ones into findings
// that cite the translation clause (G-13) and point at the exact words in the translation.
import { z } from "zod";
import type { BeliefCategory, BrandSpace, DriftKind, DriftRow, Finding, Lang, Severity } from "../types";
import { LANG_NAME } from "../lang";
import { locateQuote } from "./grounding";
import { panelFor } from "./personas";
import { CATEGORIES } from "./reader";
import { callObject, isMock, MODEL_NAME, withTracker } from "./provider";
import { clauseFor } from "./verify";

export type { DriftKind, DriftRow };

export interface DriftResult {
  rows: DriftRow[];
  of: number;
  model: string;
  mode: "cloud" | "mock";
  clause: { code: string; title: string } | null;
}

const side = z.object({ belief: z.string(), quote: z.string(), strength: z.number(), readers: z.number() });
const schema = z.object({
  pairs: z.array(
    z.object({
      category: z.enum(CATEGORIES),
      master: side.nullable(),
      variant: side.nullable(),
      note: z.string(),
      fix: z.string().nullable(),
    }),
  ),
});

// Strength scale the model uses: 1 = possible/may, 2 = likely/visible, 3 = definite/guaranteed/certain.
const STRENGTH = "strength: 1 = hedged (may, can help), 2 = plain claim (gives, visible), 3 = absolute (guaranteed, pakka, 100%, always, nichayam).";

export function labelPair(p: { master: DriftRow["master"]; variant: DriftRow["variant"] }): DriftKind {
  if (p.master && !p.variant) return "dropped";
  if (!p.master && p.variant) return "new_belief";
  if (p.master && p.variant) {
    if (p.variant.strength > p.master.strength) return "strengthened";
    if (p.variant.strength < p.master.strength) return "weakened";
  }
  return "same";
}

export const isDrift = (k: DriftKind) => k === "new_belief" || k === "strengthened";
/** A hedge or disclaimer (strength 1, e.g. "*Results may vary") the translation leaves out: the claim reads stronger. */
export const isDroppedQualifier = (r: Pick<DriftRow, "kind" | "master">) => r.kind === "dropped" && !!r.master && r.master.strength <= 1;

// words that make a claim absolute, across the supported languages
const ABSOLUTE = /पक्का|पक्की|गारंटी|हमेशा|नक्की|खात्री|निश्चित|நிச்சயம்|உறுதி|கண்டிப்பாக|pakka|guarantee|100%|always/i;

function mockPairs(master: string, variant: string): z.infer<typeof schema>["pairs"] {
  const time = (s: string) => s.match(/(\d+)\s*(weeks?|days?|हफ्त\S*|आठवड\S*|வார\S*|दिन)/i)?.[0] ?? "";
  const strong = ABSOLUTE.test(variant) && !ABSOLUTE.test(master);
  const pairs: z.infer<typeof schema>["pairs"] = [
    {
      category: "efficacy",
      master: { belief: "Skin looks more radiant after a few weeks of use", quote: time(master) || master.slice(0, 40), strength: ABSOLUTE.test(master) ? 3 : 2, readers: 5 },
      variant: { belief: strong ? "Skin glow is certain within the stated weeks" : "Skin looks more radiant after a few weeks of use", quote: time(variant) || variant.slice(0, 40), strength: ABSOLUTE.test(variant) ? 3 : 2, readers: 5 },
      note: strong ? "The translation adds a word meaning 'guaranteed'." : "Same claim in both.",
      fix: null,
    },
  ];
  if (strong)
    pairs.push({
      category: "guarantee", master: null,
      variant: { belief: "The result is guaranteed", quote: variant.match(ABSOLUTE)?.[0] ?? "", strength: 3, readers: 6 },
      note: "Only the translation promises a guaranteed outcome.", fix: null,
    });
  return pairs;
}

export function compareVersions(i: {
  master: string; variant: string; variantLang: Lang; brand: BrandSpace; apiKey?: string;
}): Promise<DriftResult> {
  // a viewer's own key (if given) applies to this comparison only
  return withTracker({ models: new Set(), calls: 0, apiKey: i.apiKey }, () => compareInContext(i));
}

/** Runs inside the caller's tracker (a check already has one), so its model and call count are recorded there. */
export async function compareInContext(i: { master: string; variant: string; variantLang: Lang; brand: BrandSpace }): Promise<DriftResult> {
  const panel = panelFor(i.brand, i.variantLang);
  const mock = isMock();
  const lang = LANG_NAME[i.variantLang];
  const embargo = i.brand.terms.filter((t) => t.kind === "embargo").map((t) => t.phrase);
  const pairs = mock
    ? mockPairs(i.master, i.variant)
    : (
        await callObject({
          schema,
          system: `You simulate ${panel.length} readers (${panel.map((p) => p.name).join("; ")}) who each read an English master ad and its ${lang} version. You compare the beliefs each version leaves behind, as a bilingual compliance reviewer would.`,
          prompt: [
            `ENGLISH MASTER:\n"""\n${i.master}\n"""`,
            `${lang.toUpperCase()} VERSION:\n"""\n${i.variant}\n"""`,
            "List every distinct belief a reader forms from either version, including implied ones, and every disclaimer or qualifier (such as '*Results may vary') as its own belief with strength 1. Pair the same belief across versions; use null on the side where it does not appear.",
            `For each side give the belief in English, the exact quote from that version that causes it (copied character for character, in its own script), ${STRENGTH} and readers = how many of the ${panel.length} readers would form it.`,
            "note: one sentence on what changed, naming the translated word and its English meaning when the strength differs (for example a word meaning 'guaranteed').",
            `fix: only when the ${lang} version adds a belief or makes it stronger, the ${lang} wording that should replace that version's quote so it says no more than the English master; otherwise null.`,
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
      return { kind, category: p.category, master: p.master, variant: p.variant, explanation: p.note, fix: isDrift(kind) ? p.fix : null };
    })
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return { rows, of: panel.length, model: mock ? "mock" : MODEL_NAME, mode: mock ? "mock" : "cloud", clause: clause ? { code: clause.code, title: clause.title } : null };
}

const ORDER: DriftKind[] = ["new_belief", "strengthened", "dropped", "weakened", "same"];

const SEVERE: BeliefCategory[] = ["guarantee", "health"];

/**
 * Flagged drift rows become findings on the translation: the span is the translated words that cause the belief,
 * the citation is the translation clause, and the suggested wording (if any) replaces only that span.
 */
export function driftFindings(
  result: DriftResult, variantText: string, masterNumber: number, lang: Lang, model: string,
): Finding[] {
  const out: Finding[] = [];
  for (const [i, r] of result.rows.entries()) {
    if (isDroppedQualifier(r)) {
      out.push({
        id: `drift-${i + 1}-dropped`, engine: "ai", category: "language_drift", severity: "medium",
        title: `Left out of the ${LANG_NAME[lang]}: “${r.master!.quote || r.master!.belief}”`,
        explanation: `The English master (#${masterNumber}) qualifies its claim (${r.master!.belief.toLowerCase()}); the ${LANG_NAME[lang]} version drops that qualifier, so its claim reads stronger. ${r.explanation}`.trim(),
        citation: result.clause ? { kind: "clause", code: result.clause.code, text: result.clause.title } : null,
        clause_code: result.clause?.code ?? null, span: null, model, drift_kind: "dropped_qualifier",
        suggestion: null, status: "open",
      });
      continue;
    }
    if (!isDrift(r.kind) || !r.variant) continue;
    const span = r.variant.quote ? locateQuote(variantText, r.variant.quote, 0.7) : null;
    const severity: Severity = SEVERE.includes(r.category) || r.variant.strength >= 3 ? "high" : "medium";
    const k = Math.max(0, Math.min(result.of, Math.round(r.variant.readers)));
    const masterSaid = r.master ? `The English master only says “${r.master.belief.toLowerCase()}”.` : `The English master (#${masterNumber}) does not say this at all.`;
    out.push({
      id: `drift-${i + 1}-${r.category}`,
      engine: "ai",
      category: "language_drift",
      severity,
      title: r.kind === "new_belief" ? `Added in ${LANG_NAME[lang]}: ${r.variant.belief}` : `Made stronger in ${LANG_NAME[lang]}: ${r.variant.belief}`,
      explanation: `${k} of ${result.of} readers believe this from the ${LANG_NAME[lang]} version. ${masterSaid} ${r.explanation}`.trim(),
      citation: result.clause ? { kind: "clause", code: result.clause.code, text: result.clause.title } : null,
      clause_code: result.clause?.code ?? null,
      span: span ? { start: span.start, end: span.end, text: span.text } : null,
      model,
      drift_kind: r.kind === "new_belief" ? "new_belief" : "strengthened",
      belief: {
        statement: r.variant.belief, category: r.category, readers: k, of: result.of, reader_names: [],
        verdict: "unsupported", fact_code: null, visual_element: null,
      },
      suggestion: r.fix && span && r.fix.trim() && r.fix.trim() !== span.text
        ? { replacement: r.fix.trim(), rationale: "Keeps the translation at the strength of the English master.", source: "translation", reread: null }
        : null,
      status: "open",
    });
  }
  return out;
}

/**
 * The drift version of the re-read gate: splice every suggested wording into the translation, compare it with the
 * master once more, and pass a fix only if its belief is no longer added or strengthened and nothing new is.
 */
export async function gateDriftFixes(
  findings: Finding[], i: { master: string; variant: string; variantLang: Lang; brand: BrandSpace },
): Promise<void> {
  const withFix = findings.filter((f) => f.suggestion && f.span).sort((a, b) => b.span!.start - a.span!.start);
  if (!withFix.length) return;
  let text = i.variant;
  let floor = Infinity;
  const applied: Finding[] = [];
  for (const f of withFix) {
    if (f.span!.end > floor) continue; // overlaps a fix already spliced in
    text = text.slice(0, f.span!.start) + f.suggestion!.replacement + text.slice(f.span!.end);
    floor = f.span!.start;
    applied.push(f);
  }
  const before = findings.length;
  const again = await compareInContext({ ...i, variant: text });
  const left = again.rows.filter((r) => isDrift(r.kind));
  const newOnes = left.filter((r) => !findings.some((f) => f.belief?.category === r.category)).length;
  for (const f of withFix) {
    const still = left.some((r) => r.category === f.belief?.category);
    f.suggestion!.reread = {
      passed: applied.includes(f) && !still && newOnes === 0,
      unsupported_before: before, unsupported_after: left.length, new_unsupported: newOnes,
      still_held: still, untested: !applied.includes(f) || undefined,
      intent_kept: again.of, of: again.of,
    };
  }
}
