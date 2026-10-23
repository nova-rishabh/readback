// ASCI-Bench runner: scores Readback's Impression Engine against real ASCI rulings and a single-prompt baseline.
//
//   pnpm bench                       20 stratified cases, 1 run, stability re-runs on 5 of them
//   pnpm bench --limit 100           every case (free-tier Gemini: expect hours and daily-quota stops)
//   pnpm bench --stability 0         skip the stability re-runs
//   pnpm bench --mock                deterministic mock readers, no API calls (pipeline smoke test)
//   pnpm bench --fresh               ignore saved results instead of resuming
//
// Per case, Readback "flags" a claim when the panel forms a grounded belief (>= 2 readers) that is contradicted or
// unsupported. The benchmark brand has an empty Fact Ledger: we do not have each advertiser's evidence, so every
// checkable claim is "unsupported" and the false-alarm rate is an upper bound. Results are written after every case
// to data/asci-bench-results.json so a run stopped by quota resumes where it left off.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=([^#]*)/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

interface Case {
  id: string;
  advertiser: string;
  product: string;
  category: string;
  medium: string;
  claim_text: string;
  outcome: "upheld" | "not_upheld";
}
interface Row {
  id: string;
  outcome: Case["outcome"];
  readback: boolean | null; // null = the check failed (quota/overload)
  baseline: boolean | null;
  beliefs: string[];
  repeats: boolean[]; // stability re-runs of Readback
  ms: number;
  error?: string;
}

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = arg("limit", 20);
const STABILITY = arg("stability", 5);
const OUT = "data/asci-bench-results.json";
if (process.argv.includes("--mock")) process.env.READBACK_MOCK_AI = "1";

/** Keep the upheld / not-upheld ratio of the full set in the first N cases. */
function stratified(all: Case[], n: number): Case[] {
  const up = all.filter((c) => c.outcome === "upheld");
  const no = all.filter((c) => c.outcome === "not_upheld");
  const nNo = Math.round((n * no.length) / all.length);
  const pick = [...up.slice(0, n - nNo), ...no.slice(0, nNo)];
  return pick.sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const { runCheck } = await import("../src/lib/ai/pipeline");
  const { callObject, isMock } = await import("../src/lib/ai/provider");
  const { BUILTIN_PERSONAS } = await import("../src/lib/ai/personas");
  type Brand = Parameters<typeof runCheck>[0]["brand"];

  // Three neutral audience personas + the three built-ins = the usual six-reader panel.
  const audience = [
    { id: "bench-urban", name: "Urban shopper, 25-34", description: "Busy professional who buys online after a quick scroll.", lang: "en" as const, builtin: false },
    { id: "bench-budget", name: "Budget-conscious student", description: "Compares prices, trusts strong claims if they sound specific.", lang: "en" as const, builtin: false },
    { id: "bench-parent", name: "Parent, 35-45", description: "Buys for the family; cautious about health and safety claims.", lang: "en" as const, builtin: false },
  ];
  const brandFor = (c: Case): Brand => ({
    id: "bench", name: c.advertiser, voice_traits: ["accurate", "measured"], palette: [], clauses: [], facts: [], terms: [],
    personas: [...audience, ...BUILTIN_PERSONAS],
  });

  const readback = async (c: Case): Promise<{ flagged: boolean | null; beliefs: string[]; error?: string }> => {
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
    if (!r || !r.readers.length) return { flagged: null, beliefs: [], error: error ?? "no readers answered" };
    const bad = r.findings.filter((f) => f.belief && (f.belief.verdict === "contradicted" || f.belief.verdict === "unsupported"));
    return { flagged: bad.length > 0, beliefs: bad.map((f) => `${f.belief!.readers}/${f.belief!.of} ${f.belief!.statement}`), error };
  };

  const baseline = async (c: Case): Promise<boolean | null> => {
    if (isMock()) return /\d+%|guarantee|best|#1|cure|instant|100%|proven/i.test(c.claim_text);
    try {
      const o = await callObject({
        schema: z.object({ misleading: z.boolean() }),
        system: "You are an advertising compliance checker for India.",
        prompt: `Advertiser: ${c.advertiser}. Product: ${c.product}.\nAd claim:\n"""\n${c.claim_text}\n"""\nIs this ad likely to be found misleading under the ASCI Code?`,
        temperature: 0,
      });
      return o.misleading;
    } catch {
      return null;
    }
  };

  const all = JSON.parse(readFileSync("data/asci-bench.json", "utf8")) as Case[];
  const cases = stratified(all, Math.min(LIMIT, all.length));
  const mode = isMock() ? "mock" : "cloud";
  const prev = !process.argv.includes("--fresh") && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const rows = new Map<string, Row>(prev?.mode === mode ? (prev.rows as Row[]).map((r) => [r.id, r]) : []);
  const save = () =>
    writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), mode, limit: LIMIT, metrics: metrics([...rows.values()]), rows: [...rows.values()] }, null, 2));

  console.log(`ASCI-Bench: ${cases.length} cases (${mode} mode), stability re-runs on ${Math.min(STABILITY, cases.length)}\n`);
  for (const [i, c] of cases.entries()) {
    const done = rows.get(c.id);
    const wantRepeats = i < STABILITY ? 2 : 0;
    if (done && done.readback !== null && done.baseline !== null && done.repeats.length >= wantRepeats) continue;
    const t = Date.now();
    const r = await readback(c);
    const b = await baseline(c);
    const repeats: boolean[] = [];
    for (let k = 0; k < wantRepeats && r.flagged !== null; k++) {
      const again = await readback(c);
      if (again.flagged !== null) repeats.push(again.flagged);
    }
    const row: Row = { id: c.id, outcome: c.outcome, readback: r.flagged, baseline: b, beliefs: r.beliefs, repeats, ms: Date.now() - t, error: r.error };
    rows.set(c.id, row);
    save();
    const mark = (v: boolean | null) => (v === null ? "ERR " : v ? "FLAG" : "pass");
    console.log(`${c.id.padEnd(9)} ${c.outcome.padEnd(10)} readback ${mark(r.flagged)}  baseline ${mark(b)}  ${((Date.now() - t) / 1000).toFixed(1)}s${r.error ? `  (${r.error.slice(0, 60)})` : ""}`);
  }

  const m = metrics([...rows.values()].filter((r) => cases.some((c) => c.id === r.id)));
  save();
  const pct = (x: number | null) => (x === null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`);
  console.log(`\n                         Readback   Single-prompt baseline`);
  console.log(`Recall on Upheld         ${pct(m.readback.recall)}     ${pct(m.baseline.recall)}`);
  console.log(`False alarms, Not Upheld ${pct(m.readback.false_alarm)}     ${pct(m.baseline.false_alarm)}`);
  console.log(`Run-to-run stability     ${pct(m.readback.stability)}       (not measured)`);
  console.log(`\nScored ${m.scored} of ${cases.length} cases (${m.upheld} upheld, ${m.not_upheld} not upheld); ${m.errors} failed and are excluded.`);
  console.log(`Saved to ${OUT}`);
}

function metrics(rows: Row[]) {
  const ok = rows.filter((r) => r.readback !== null && r.baseline !== null);
  const up = ok.filter((r) => r.outcome === "upheld");
  const no = ok.filter((r) => r.outcome === "not_upheld");
  const rate = (xs: Row[], k: "readback" | "baseline") => (xs.length ? xs.filter((r) => r[k]).length / xs.length : null);
  const reps = ok.filter((r) => r.repeats.length);
  const stable = reps.filter((r) => r.repeats.every((x) => x === r.readback)).length;
  return {
    scored: ok.length, upheld: up.length, not_upheld: no.length, errors: rows.length - ok.length,
    readback: { recall: rate(up, "readback"), false_alarm: rate(no, "readback"), stability: reps.length ? stable / reps.length : null },
    baseline: { recall: rate(up, "baseline"), false_alarm: rate(no, "baseline") },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
