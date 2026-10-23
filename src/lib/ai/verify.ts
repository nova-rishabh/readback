// Fact verification: top-3 facts by cosine (db matchFacts, else in-memory), one batched LLM judge call,
// and conversion of judged groups into AI claim findings.
import { z } from "zod";
import { matchFacts } from "@/lib/db/queries";
import type { BrandSpace, Fact, Finding, Severity, Verdict } from "../types";
import { cosine, isAmbiguous, type BeliefGroup } from "./group";
import { mockJudge } from "./mock";
import { callObject, embedTexts, isMock } from "./provider";

export interface Judged {
  verdict: "supported" | "contradicted" | "unsupported";
  fact_code: string | null;
  reason: string;
}

const NO_FACT: Judged = { verdict: "unsupported", fact_code: null, reason: "Unsupported: no fact in the ledger covers this claim." };
const factVecs = new Map<string, number[]>();

async function memoryTopFacts(brand: BrandSpace, emb: number[], k: number, embargo: string[]): Promise<Fact[]> {
  const key = (f: Fact) => `${f.code}@${f.version}:${f.statement}`;
  const missing = brand.facts.filter((f) => !factVecs.has(key(f)));
  if (missing.length) {
    const vecs = await embedTexts(missing.map((f) => f.statement), embargo);
    missing.forEach((f, i) => factVecs.set(key(f), vecs[i]));
  }
  return brand.facts
    .map((f) => ({ f, s: cosine(emb, factVecs.get(key(f)) ?? []) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.f);
}

export async function topFacts(brand: BrandSpace, emb: number[], k = 3, embargo: string[] = []): Promise<Fact[]> {
  if (!isMock()) {
    try {
      const r = await matchFacts(emb, k);
      if (r.length) return r.map((x) => x.fact);
    } catch {
      /* db unavailable: fall through to in-memory cosine */
    }
  }
  return memoryTopFacts(brand, emb, k, embargo);
}

const judgeSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      verdict: z.enum(["supported", "contradicted", "unsupported"]),
      fact_code: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});

export const describeFact = (f: Fact) =>
  `${f.code} [${f.status}${f.expires_on ? `, expires ${f.expires_on}` : ""}]: ${f.statement}`;

export async function verifyGroups(groups: BeliefGroup[], brand: BrandSpace, embargo: string[]): Promise<Judged[]> {
  if (isMock()) return groups.map((g) => mockJudge(g.statement));
  const cands = await Promise.all(groups.map((g) => topFacts(brand, g.centroid, 3, embargo)));
  const todo = groups.map((_, i) => i).filter((i) => cands[i].length);
  const res: Judged[] = groups.map(() => NO_FACT);
  if (!todo.length) return res;
  const prompt = [
    "A reader panel formed the beliefs below from a marketing post. For each belief, judge it against its candidate facts from the brand's Fact Ledger.",
    "supported: an active fact backs the claim at the strength it is stated. contradicted: a fact conflicts with it (smaller number, longer timeframe, weaker wording). unsupported: no candidate fact backs it. Expired or retired facts never support a claim.",
    "fact_code is the single most relevant candidate code, or null.",
    ...todo.map((i) => `\n#${i} BELIEF: ${groups[i].statement}\nCANDIDATE FACTS:\n${cands[i].map(describeFact).join("\n")}`),
  ].join("\n");
  try {
    const o = await callObject({
      schema: judgeSchema,
      system: "You are a strict advertising-claims reviewer. Judge only from the facts given; never assume facts not listed.",
      prompt,
      embargo,
      temperature: 0,
    });
    for (const v of o.verdicts) {
      if (!todo.includes(v.index)) continue;
      const fact = cands[v.index].find((f) => f.code === v.fact_code);
      const verdict = v.verdict === "supported" && fact && fact.status !== "active" ? "unsupported" : v.verdict;
      res[v.index] = { verdict, fact_code: fact?.code ?? null, reason: v.reason };
    }
  } catch {
    /* judge failed: every claim stays "unsupported (no fact)", never "false" */
  }
  return res;
}

const SEVERE = new Set(["health", "guarantee"]);

// Guideline clause that governs each belief category (Velura numbering; ignored when the brand lacks the clause).
const CLAUSE_FOR: Record<string, string> = {
  endorsement: "G-04", health: "G-04", environment: "G-05", efficacy: "G-12", guarantee: "G-12",
  urgency: "G-14", price: "G-14", comparison: "G-15", language_drift: "G-13",
};
export const clauseFor = (brand: BrandSpace, key: string) => brand.clauses.find((c) => c.code === CLAUSE_FOR[key]) ?? null;

export function buildClaimFindings(groups: BeliefGroup[], judged: Judged[], of: number, brand: BrandSpace, model: string): Finding[] {
  const out: Finding[] = [];
  groups.forEach((g, i) => {
    const j = judged[i];
    if (j.verdict === "supported") return;
    const k = g.readerIds.length;
    const category = g.items[0].category;
    const verdict: Verdict = j.verdict === "contradicted" ? "contradicted" : isAmbiguous(k, of) ? "ambiguous" : j.verdict;
    const severity: Severity = verdict === "contradicted" ? "high" : verdict === "ambiguous" ? "low" : SEVERE.has(category) ? "high" : "medium";
    const fact = brand.facts.find((f) => f.code === j.fact_code) ?? null;
    const clause = clauseFor(brand, category);
    const spans = g.items.flatMap((x) => (x.span ? [x.span] : []));
    const tally = new Map<string, number>();
    spans.forEach((s) => tally.set(`${s.start}:${s.end}`, (tally.get(`${s.start}:${s.end}`) ?? 0) + 1));
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const span = spans.find((s) => `${s.start}:${s.end}` === top) ?? null;
    const names = g.items.map((x) => x.reader_name).filter((n, idx, a) => a.indexOf(n) === idx);
    out.push({
      id: `ai-${out.length + 1}`,
      engine: "ai",
      category: "claim",
      severity,
      title: `${k} of ${of} readers believed: ${g.statement}`,
      explanation: `${k} of ${of} readers took away "${g.statement}"${span ? ` from "${span.text}"` : " from the image"}. ${j.reason}`,
      citation: fact
        ? { kind: "fact", code: fact.code, text: fact.statement }
        : clause
          ? { kind: "clause", code: clause.code, text: clause.title }
          : null,
      clause_code: clause?.code ?? null,
      span,
      model,
      belief: {
        statement: g.statement,
        category,
        readers: k,
        of,
        reader_names: names,
        verdict,
        fact_code: j.fact_code,
        visual_element: g.items.find((x) => x.visual)?.visual ?? null,
      },
      suggestion: null,
      status: "open",
    });
  });
  return out;
}
