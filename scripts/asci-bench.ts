// ASCI-Bench runner: scores Readback's Impression Engine against real ASCI rulings and a single-prompt baseline.
//
//   pnpm bench                       all 100 cases, Readback 3 runs each, baseline once, no fact ledger
//   pnpm bench --ledger              same, but each case's brand gets the substantiation ASCI accepted
//                                    (data/asci-evidence.json) as its Fact Ledger, and the baseline sees it too
//   pnpm bench --limit 20            a stratified slice (keeps the upheld / not-upheld ratio)
//   pnpm bench --runs 1              fewer Readback runs per case (stability needs 2 or more)
//   pnpm bench --concurrency 2       cases in flight at once (free-tier Gemini: keep this at 1 or 2)
//   pnpm bench --mock                deterministic mock readers, no API calls (pipeline smoke test)
//   pnpm bench --fresh               ignore saved results instead of resuming
//   pnpm bench --ids ASCI-002,ASCI-014 --out data/x.json   only these cases, to another file
//
// Per run, Readback "flags" a case when the panel forms a grounded belief (>= 2 of 6 readers) that the fact judge
// finds contradicted or unsupported. The case verdict is the majority of its runs. Results are written after every
// case, so a run stopped by quota resumes where it left off. Scoring lives in src/lib/bench/metrics.ts and is shared
// with the in-app results page.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { z } from "zod";
import {
  computeMetrics, majority, pct, type BenchCase, type BenchRow, type CaseEvidence, type Rate,
} from "../src/lib/bench/metrics";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=([^#]*)/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = arg("limit", 100);
const RUNS = Math.max(1, arg("runs", 3));
const CONCURRENCY = Math.max(1, arg("concurrency", 1));
const LEDGER = process.argv.includes("--ledger");
const sarg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const IDS = sarg("ids")?.split(",").map((s) => s.trim()) ?? null;
const OUT = sarg("out") ?? (LEDGER ? "data/asci-bench-results-ledger.json" : "data/asci-bench-results.json");
if (process.argv.includes("--mock")) process.env.READBACK_MOCK_AI = "1";
// the benchmark never touches the live app's embedding model (gemini-embedding-001: 1,000 requests a day on the free
// tier, which the deployed demo needs); it uses the two newer models, each with its own daily quota
process.env.READBACK_EMBED_MODELS ??= "gemini-embedding-2-preview,gemini-embedding-2";
let embeddingsExhausted = false;

/** Keep the upheld / not-upheld ratio of the full set in the first N cases. */
function stratified(all: BenchCase[], n: number): BenchCase[] {
  if (n >= all.length) return all;
  const up = all.filter((c) => c.outcome === "upheld");
  const no = all.filter((c) => c.outcome === "not_upheld");
  const nNo = Math.round((n * no.length) / all.length);
  return [...up.slice(0, n - nNo), ...no.slice(0, nNo)].sort((a, b) => a.id.localeCompare(b.id));
}

function loadEvidence(): Map<string, CaseEvidence> {
  const path = "data/asci-evidence.json";
  if (!existsSync(path)) return new Map();
  return new Map((JSON.parse(readFileSync(path, "utf8")) as CaseEvidence[]).map((e) => [e.id, e]));
}

async function main() {
  const { runCheck } = await import("../src/lib/ai/pipeline");
  const { callObject, isMock, MODEL_NAME } = await import("../src/lib/ai/provider");
  const { BUILTIN_PERSONAS } = await import("../src/lib/ai/personas");
  type Brand = Parameters<typeof runCheck>[0]["brand"];

  const all = JSON.parse(readFileSync("data/asci-bench.json", "utf8")) as BenchCase[];
  const evidence = loadEvidence();
  if (LEDGER && !evidence.size) throw new Error("--ledger needs data/asci-evidence.json");
  const ledgerOf = (c: BenchCase) => (LEDGER ? evidence.get(c.id)?.ledger ?? [] : []);

  // Three neutral audience personas + the three built-ins = the usual six-reader panel.
  const audience = [
    { id: "bench-urban", name: "Urban shopper, 25-34", description: "Busy professional who buys online after a quick scroll.", lang: "en" as const, builtin: false },
    { id: "bench-budget", name: "Budget-conscious student", description: "Compares prices, trusts strong claims if they sound specific.", lang: "en" as const, builtin: false },
    { id: "bench-parent", name: "Parent, 35-45", description: "Buys for the family; cautious about health and safety claims.", lang: "en" as const, builtin: false },
  ];
  const brandFor = (c: BenchCase): Brand => ({
    id: "bench", name: c.advertiser, voice_traits: ["accurate", "measured"], palette: [], clauses: [], terms: [],
    facts: ledgerOf(c).map((statement, i) => ({
      id: `${c.id}-F${i + 1}`, code: `E-${String(i + 1).padStart(2, "0")}`, statement, source: "Substantiation accepted by ASCI",
      owner: c.advertiser, expires_on: null, version: 1, status: "active" as const,
    })),
    personas: [...audience, ...BUILTIN_PERSONAS],
  });

  const readbackOnce = async (c: BenchCase): Promise<{ flagged: boolean | null; beliefs: string[]; error?: string }> => {
    let error: string | undefined;
    const r = await runCheck(
      {
        text: c.claim_text, intent: `Promote ${c.product}`, lang: "en", channel: c.medium === "digital" ? "website" : "other",
        image: null, imageAlt: null, lockedPhrases: [], brand: brandFor(c), options: { fixes: false, cache: false },
      },
      (e) => {
        if (e.type === "error") error = e.message;
      },
    ).catch((e: unknown) => ((error = e instanceof Error ? e.message : String(e)), null));
    if (!r || !r.readers.length || r.summary.partial) return { flagged: null, beliefs: [], error: error ?? "no readers answered" };
    if (r.summary.embeddings?.includes("lexical") || r.summary.embeddings?.includes("word overlap")) {
      // word-overlap grouping is the app's last-resort fallback, not the engine being measured: stop and resume later
      embeddingsExhausted = true;
      return { flagged: null, beliefs: [], error: "embedding quota exhausted on every benchmark model" };
    }
    const bad = r.findings.filter((f) => f.belief && (f.belief.verdict === "contradicted" || f.belief.verdict === "unsupported"));
    return { flagged: bad.length > 0, beliefs: bad.map((f) => `${f.belief!.readers}/${f.belief!.of} ${f.belief!.statement} [${f.belief!.verdict}]`), error };
  };

  const baseline = async (c: BenchCase): Promise<boolean | null> => {
    const ledger = ledgerOf(c);
    if (isMock()) return /\d+%|guarantee|best|#1|cure|instant|100%|proven/i.test(c.claim_text) && !ledger.length;
    try {
      const o = await callObject({
        schema: z.object({ misleading: z.boolean() }),
        system: "You are an advertising compliance checker for India.",
        prompt: [
          `Advertiser: ${c.advertiser}. Product: ${c.product}.\nAd claim:\n"""\n${c.claim_text}\n"""`,
          ledger.length ? `The advertiser holds this substantiation:\n${ledger.map((l) => `- ${l}`).join("\n")}` : "",
          "Is this ad likely to be found misleading under the ASCI Code?",
        ].filter(Boolean).join("\n\n"),
        temperature: 0,
      });
      return o.misleading;
    } catch {
      return null;
    }
  };

  const cases = IDS ? all.filter((c) => IDS.includes(c.id)) : stratified(all, Math.min(LIMIT, all.length));
  const mode = isMock() ? "mock" : "cloud";
  const prev = !process.argv.includes("--fresh") && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const rows = new Map<string, BenchRow>(
    prev?.mode === mode && prev?.version === 3 ? (prev.rows as BenchRow[]).map((r) => [r.id, r]) : [],
  );
  const started = prev?.started_at ?? new Date().toISOString();
  const save = () =>
    writeFileSync(OUT, JSON.stringify({
      version: 3, mode, ledger: LEDGER, runs: RUNS, model: MODEL_NAME, started_at: started, generated_at: new Date().toISOString(),
      cases: cases.length, metrics: computeMetrics([...rows.values()], cases, evidence), rows: [...rows.values()],
    }, null, 2));

  console.log(`ASCI-Bench: ${cases.length} cases, ${RUNS} Readback run(s) each, ${LEDGER ? "with" : "without"} evidence ledger (${mode})\n`);
  const done = (r: BenchRow | undefined) =>
    !!r && r.baseline !== null && r.runs.length >= RUNS && r.runs.filter((x) => x !== null).length >= Math.min(RUNS, 2);
  // --not-upheld-first: when the daily quota may run out, score the cases where false alarms are measured first
  const todo = cases.filter((c) => !done(rows.get(c.id)))
    .sort((a, b) => (process.argv.includes("--not-upheld-first") ? Number(a.outcome === "upheld") - Number(b.outcome === "upheld") : 0));

  const one = async (c: BenchCase) => {
    const t = Date.now();
    const old = rows.get(c.id);
    const runs = (old?.runs ?? []).filter((x) => x !== null);
    let beliefs = old?.beliefs ?? [];
    let error: string | undefined;
    for (let tries = 0; runs.length < RUNS && tries < RUNS + 4 && !embeddingsExhausted; tries++) {
      const r = await readbackOnce(c);
      if (r.flagged === null) {
        error = r.error;
        // a per-minute limit clears within a minute: wait it out rather than spend the case's retries
        if (/quota|limit|overloaded|503|429/i.test(r.error ?? "")) await new Promise((res) => setTimeout(res, 65_000));
        continue;
      }
      if (!runs.length || !beliefs.length) beliefs = r.beliefs;
      runs.push(r.flagged);
    }
    const b = old?.baseline ?? (await baseline(c));
    const row: BenchRow = { id: c.id, outcome: c.outcome, runs, readback: majority(runs), baseline: b, beliefs, ms: Date.now() - t, error: runs.length < RUNS ? error : undefined };
    rows.set(c.id, row);
    save();
    const mark = (v: boolean | null) => (v === null ? "ERR " : v ? "FLAG" : "pass");
    console.log(
      `${c.id.padEnd(9)} ${c.outcome.padEnd(10)} readback ${mark(row.readback)} [${runs.map((x) => (x ? "F" : "p")).join("")}]  baseline ${mark(b)}  ${((Date.now() - t) / 1000).toFixed(1)}s${row.error ? `  (${row.error.slice(0, 60)})` : ""}`,
    );
  };

  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let c = queue.shift(); c && !embeddingsExhausted; c = queue.shift()) await one(c);
  }));

  save();
  if (embeddingsExhausted) console.log("\nStopped: the daily embedding quota is used up on every benchmark model. Run the same command after it resets to resume.");
  const m = computeMetrics([...rows.values()], cases, evidence);
  const show = (r: Rate) => `${pct(r).padStart(6)} (${r.k}/${r.n})`;
  console.log(`\n                          Readback            Single-prompt baseline`);
  console.log(`Recall on upheld          ${show(m.readback.recall)}   ${show(m.baseline.recall)}`);
  console.log(`False alarms, not upheld  ${show(m.readback.false_alarm)}   ${show(m.baseline.false_alarm)}`);
  console.log(`Precision                 ${show(m.readback.precision)}   ${show(m.baseline.precision)}`);
  console.log(`Run-to-run stability      ${show(m.readback.stability)}`);
  for (const g of m.byGround) console.log(`  recall, ${g.ground.padEnd(16)} ${show(g.readback)}   ${show(g.baseline)}`);
  console.log(`\nScored ${m.scored} of ${cases.length} cases (${m.upheld} upheld, ${m.not_upheld} not upheld); ${m.errors} failed and are excluded.`);
  console.log(`Saved to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
