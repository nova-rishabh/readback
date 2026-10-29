// ASCI-Bench scoring, shared by the CLI runner (scripts/asci-bench.ts) and the in-app results page (/bench).
// Pure functions only, so both a Node script and a Server Component can import them.

export type Outcome = "upheld" | "not_upheld";
export type Ground = "unsubstantiated" | "exaggeration" | "implication" | "omission" | "comparison" | "statutory";
export const GROUNDS: Ground[] = ["unsubstantiated", "exaggeration", "implication", "omission", "comparison", "statutory"];

export interface BenchCase {
  id: string;
  advertiser: string;
  product: string;
  category: string;
  medium: string;
  claim_text: string;
  outcome: Outcome;
  grounds: string[];
  ruling_summary: string;
  source_url: string;
  date: string;
}

/** What the advertiser submitted to ASCI, and which parts the panel accepted (data/asci-evidence.json). */
export interface CaseEvidence {
  id: string;
  grounds: Ground[]; // re-checked against the ruling text
  evidence: { statement: string; source: string; accepted: boolean }[];
  ledger: string[]; // accepted substantiation, phrased as approved facts
  upheld_claims: string[];
  not_upheld_claims: string[];
  note: string;
  readable: boolean;
}

export interface BenchRow {
  id: string;
  outcome: Outcome;
  runs: (boolean | null)[]; // Readback's verdict on each run; null = the run failed (quota, overload)
  readback: boolean | null; // majority of the successful runs
  baseline: boolean | null;
  beliefs: string[]; // flagged beliefs from the first successful run, "k/n statement [verdict]"
  ms: number;
  error?: string;
}

export interface Rate {
  k: number;
  n: number;
  rate: number | null;
  lo: number | null; // Wilson 95% interval
  hi: number | null;
}

export interface BenchMetrics {
  scored: number;
  upheld: number;
  not_upheld: number;
  errors: number;
  readback: { recall: Rate; false_alarm: Rate; precision: Rate; stability: Rate };
  baseline: { recall: Rate; false_alarm: Rate; precision: Rate };
  byGround: { ground: Ground; cases: number; readback: Rate; baseline: Rate }[];
  byCategory: { category: string; upheld: number; not_upheld: number; readback_recall: Rate; readback_fa: Rate; baseline_recall: Rate; baseline_fa: Rate }[];
}

export function wilson(k: number, n: number): Rate {
  if (!n) return { k, n, rate: null, lo: null, hi: null };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, rate: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Majority of the successful runs; a tie counts as flagged (the reviewer sees it either way). */
export function majority(runs: (boolean | null)[]): boolean | null {
  const ok = runs.filter((r): r is boolean => r !== null);
  if (!ok.length) return null;
  return ok.filter(Boolean).length * 2 >= ok.length;
}

export function computeMetrics(rows: BenchRow[], cases: BenchCase[], evidence?: Map<string, CaseEvidence>): BenchMetrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const ok = rows.filter((r) => r.readback !== null && r.baseline !== null && byId.has(r.id));
  const up = ok.filter((r) => r.outcome === "upheld");
  const no = ok.filter((r) => r.outcome === "not_upheld");
  const count = (xs: BenchRow[], k: "readback" | "baseline") => xs.filter((r) => r[k]).length;
  const precision = (k: "readback" | "baseline") => {
    const flagged = ok.filter((r) => r[k]);
    return wilson(flagged.filter((r) => r.outcome === "upheld").length, flagged.length);
  };
  const multi = ok.filter((r) => r.runs.filter((x) => x !== null).length >= 2);
  const stable = multi.filter((r) => {
    const v = r.runs.filter((x) => x !== null);
    return v.every((x) => x === v[0]);
  }).length;

  const groundsOf = (id: string): string[] => evidence?.get(id)?.grounds ?? byId.get(id)?.grounds ?? [];
  const byGround = GROUNDS.map((g) => {
    const xs = up.filter((r) => groundsOf(r.id).includes(g));
    return { ground: g, cases: xs.length, readback: wilson(count(xs, "readback"), xs.length), baseline: wilson(count(xs, "baseline"), xs.length) };
  }).filter((g) => g.cases > 0);

  const cats = [...new Set(ok.map((r) => byId.get(r.id)!.category))].sort();
  const byCategory = cats.map((category) => {
    const u = up.filter((r) => byId.get(r.id)!.category === category);
    const n = no.filter((r) => byId.get(r.id)!.category === category);
    return {
      category, upheld: u.length, not_upheld: n.length,
      readback_recall: wilson(count(u, "readback"), u.length), readback_fa: wilson(count(n, "readback"), n.length),
      baseline_recall: wilson(count(u, "baseline"), u.length), baseline_fa: wilson(count(n, "baseline"), n.length),
    };
  });

  return {
    scored: ok.length,
    upheld: up.length,
    not_upheld: no.length,
    errors: rows.filter((r) => byId.has(r.id)).length - ok.length,
    readback: {
      recall: wilson(count(up, "readback"), up.length),
      false_alarm: wilson(count(no, "readback"), no.length),
      precision: precision("readback"),
      stability: wilson(stable, multi.length),
    },
    baseline: {
      recall: wilson(count(up, "baseline"), up.length),
      false_alarm: wilson(count(no, "baseline"), no.length),
      precision: precision("baseline"),
    },
    byGround,
    byCategory,
  };
}

export const pct = (r: Rate | number | null, digits = 1): string => {
  const v = typeof r === "number" || r === null ? r : r.rate;
  return v === null ? "n/a" : `${(v * 100).toFixed(digits)}%`;
};
