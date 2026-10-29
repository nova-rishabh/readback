import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  computeMetrics, GROUNDS, pct, type BenchCase, type BenchMetrics, type BenchRow, type CaseEvidence, type Rate,
} from "@/lib/bench/metrics";
import { Page, PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "ASCI-Bench results" };
export const dynamic = "force-dynamic";

interface ResultFile { version?: number; runs?: number; model?: string; generated_at: string; rows: BenchRow[]; ledger?: boolean }

function load<T>(name: string): T | null {
  const p = join(process.cwd(), "data", name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

const GROUND_LABEL: Record<string, string> = {
  unsubstantiated: "Unsubstantiated", exaggeration: "Exaggeration", implication: "Misleading by implication",
  omission: "Omission (missing qualifier)", comparison: "Comparison or ranking", statutory: "Breaks a law",
};

function RateCell({ r, good }: { r: Rate; good: "high" | "low" }) {
  if (r.rate === null) return <td className="px-3 py-2 text-muted">n/a</td>;
  return (
    <td className="px-3 py-2">
      <span className="font-mono text-[15px] font-medium tabular-nums">{pct(r)}</span>
      <span className="ml-1.5 font-mono text-[11.5px] text-muted tabular-nums">
        {r.k}/{r.n} · 95% CI {pct(r.lo, 0)} to {pct(r.hi, 0)}
      </span>
      <span className="sr-only">{good === "high" ? "higher is better" : "lower is better"}</span>
    </td>
  );
}

function Headline({ title, lede, m }: { title: string; lede: string; m: BenchMetrics }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-md border border-rule bg-sheet p-5">
      <div>
        <h2 className="font-display text-[22px] leading-tight">{title}</h2>
        <p className="mt-1 max-w-[80ch] text-[13.5px] text-muted">{lede}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-rule-strong text-[12.5px] text-muted">
              <th scope="col" className="px-3 py-2 font-medium">Metric</th>
              <th scope="col" className="px-3 py-2 font-medium">Readback (6 readers, majority of runs)</th>
              <th scope="col" className="px-3 py-2 font-medium">Single-prompt baseline</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <th scope="row" className="px-3 py-2 font-normal">Recall on upheld rulings <span className="text-muted">(higher is better)</span></th>
              <RateCell r={m.readback.recall} good="high" />
              <RateCell r={m.baseline.recall} good="high" />
            </tr>
            <tr className="border-b border-rule">
              <th scope="row" className="px-3 py-2 font-normal">False alarms on not-upheld rulings <span className="text-muted">(lower is better)</span></th>
              <RateCell r={m.readback.false_alarm} good="low" />
              <RateCell r={m.baseline.false_alarm} good="low" />
            </tr>
            <tr className="border-b border-rule">
              <th scope="row" className="px-3 py-2 font-normal">Precision: flags that ASCI upheld</th>
              <RateCell r={m.readback.precision} good="high" />
              <RateCell r={m.baseline.precision} good="high" />
            </tr>
            <tr>
              <th scope="row" className="px-3 py-2 font-normal">Run-to-run stability: every run agreed</th>
              <RateCell r={m.readback.stability} good="high" />
              <td className="px-3 py-2 text-[12.5px] text-muted">Not measured (one run at temperature 0)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-muted">
        Scored {m.scored} cases ({m.upheld} upheld, {m.not_upheld} not upheld){m.errors ? `; ${m.errors} failed every run (Gemini quota) and are left out` : ""}.
      </p>
    </section>
  );
}

export default async function BenchPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const cases = load<BenchCase[]>("asci-bench.json") ?? [];
  const evidenceList = load<CaseEvidence[]>("asci-evidence.json") ?? [];
  const evidence = new Map(evidenceList.map((e) => [e.id, e]));
  // the latest complete run, or (while the full run waits on the daily quota) the latest partial one
  const full = load<ResultFile>("asci-bench-results.json");
  const plain = full ?? load<ResultFile>("asci-bench-results-v3.1-partial.json");
  const ledger = load<ResultFile>("asci-bench-results-ledger.json");
  const r2 = load<{ metrics: { readback: { recall: number; false_alarm: number }; baseline: { recall: number; false_alarm: number } } }>("asci-bench-results-round2.json");
  const mPlain = plain ? computeMetrics(plain.rows, cases, evidence) : null;
  const mLedger = ledger ? computeMetrics(ledger.rows, cases, evidence) : null;

  const byId = new Map(cases.map((c) => [c.id, c]));
  const plainRows = new Map((plain?.rows ?? []).map((r) => [r.id, r]));
  const ledgerRows = new Map((ledger?.rows ?? []).map((r) => [r.id, r]));
  const filters = [
    { id: "all", label: "All cases" },
    { id: "missed", label: "Upheld but not flagged" },
    { id: "false", label: "Not upheld but flagged" },
    { id: "unstable", label: "Runs disagreed" },
  ];
  const shown = cases.filter((c) => {
    const r = plainRows.get(c.id);
    if (!show || show === "all") return true;
    if (!r || r.readback === null) return false;
    if (show === "missed") return c.outcome === "upheld" && !r.readback;
    if (show === "false") return c.outcome === "not_upheld" && r.readback;
    if (show === "unstable") return new Set(r.runs.filter((x) => x !== null)).size > 1;
    return true;
  });
  const flag = (v: boolean | null | undefined) => (v === null || v === undefined ? "–" : v ? "Flag" : "Pass");

  return (
    <Page wide>
      <PageHeader
        title="ASCI-Bench"
        lede="How often does Readback catch what India's advertising regulator actually ruled against, and how often does it cry wolf? 100 real rulings from the ASCI Consumer Complaints Council (66 upheld, 34 not upheld), each run three times through the six-reader engine and once through a single-prompt baseline."
      />

      {!mPlain ? (
        <p className="rounded-md border border-dashed border-rule-strong px-5 py-8 text-center text-[14px] text-muted">
          No benchmark results yet. Run <code className="font-mono">pnpm bench</code> to produce them.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {plain && plain.rows.length < cases.length && (
            <p className="rounded-md border border-ochre/40 bg-ochre-tint px-4 py-2.5 text-[13.5px]">
              <span className="font-medium">Partial run.</span> {plain.rows.length} of {cases.length} cases so far: the free Gemini tier allows
              1,000 embedding requests per model per day, and the run resumes where it stopped when the quota resets. Cases not yet run
              show “not run” below.
            </p>
          )}
          <Headline
            title="Without the advertiser's evidence"
            lede="The brand's Fact Ledger is empty, as for a brand that has not recorded its substantiation yet. Every checkable claim is then unsupported, so this is the strictest setting and its false-alarm rate is an upper bound."
            m={mPlain}
          />
          {mLedger && (
            <Headline
              title="With the evidence ASCI accepted"
              lede="Each case's Fact Ledger holds only the substantiation the ASCI panel accepted as adequate (see the evidence column below); the baseline is shown the same evidence. This is how Readback is meant to run: against a brand's own approved facts."
              m={mLedger}
            />
          )}
          {r2 && (
            <p className="text-[13px] text-muted">
              Round 2 ran 20 of these cases once each: Readback recall {pct(r2.metrics.readback.recall)}, false alarms {pct(r2.metrics.readback.false_alarm)};
              baseline {pct(r2.metrics.baseline.recall)} and {pct(r2.metrics.baseline.false_alarm)}. Round 3 runs all 100, three times each.
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-labelledby="ground-h" className="flex flex-col gap-3 rounded-md border border-rule bg-sheet p-5">
              <div>
                <h2 id="ground-h" className="font-display text-[20px]">Recall by ground</h2>
                <p className="mt-0.5 text-[13px] text-muted">Upheld rulings only, grouped by the reasons the ruling gives (one ruling can have several). Without evidence.</p>
              </div>
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-rule-strong text-[12px] text-muted">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Ground</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Cases</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Readback</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUNDS.map((g) => mPlain.byGround.find((x) => x.ground === g)).filter(Boolean).map((g) => (
                    <tr key={g!.ground} className="border-b border-rule last:border-0">
                      <th scope="row" className="py-1.5 pr-2 font-normal">{GROUND_LABEL[g!.ground]}</th>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{g!.cases}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{pct(g!.readback, 0)}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{pct(g!.baseline, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section aria-labelledby="cat-h" className="flex flex-col gap-3 rounded-md border border-rule bg-sheet p-5">
              <div>
                <h2 id="cat-h" className="font-display text-[20px]">By product category</h2>
                <p className="mt-0.5 text-[13px] text-muted">Recall on upheld and false alarms on not-upheld rulings. Without evidence.</p>
              </div>
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-rule-strong text-[12px] text-muted">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Category</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Upheld / not</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Recall</th>
                    <th scope="col" className="py-1.5 text-right font-medium">False alarms</th>
                  </tr>
                </thead>
                <tbody>
                  {mPlain.byCategory.map((c) => (
                    <tr key={c.category} className="border-b border-rule last:border-0">
                      <th scope="row" className="py-1.5 pr-2 font-normal capitalize">{c.category}</th>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{c.upheld} / {c.not_upheld}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{pct(c.readback_recall, 0)}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{pct(c.readback_fa, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section aria-labelledby="cases-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="cases-h" className="font-display text-[22px]">Every case</h2>
              <nav aria-label="Filter cases" className="flex flex-wrap gap-1.5 text-[13px]">
                {filters.map((f) => (
                  <Link
                    key={f.id}
                    href={f.id === "all" ? "/app/bench" : `/app/bench?show=${f.id}`}
                    aria-current={(show ?? "all") === f.id ? "page" : undefined}
                    className={(show ?? "all") === f.id ? "rounded-[5px] border border-ink bg-ink px-2.5 py-1 text-sheet" : "rounded-[5px] border border-rule-strong bg-sheet px-2.5 py-1 hover:border-ink"}
                  >
                    {f.label}
                  </Link>
                ))}
              </nav>
            </div>
            <p className="text-[13px] text-muted">
              {shown.length} case{shown.length === 1 ? "" : "s"}. Runs show each of Readback&apos;s three verdicts (F = flagged, p = passed).
              Open a row for the claim, what the readers flagged, and the evidence ASCI accepted.
            </p>
            <ul className="flex flex-col divide-y divide-rule rounded-md border border-rule bg-sheet">
              {shown.map((c) => {
                const r = plainRows.get(c.id);
                const l = ledgerRows.get(c.id);
                const e = evidence.get(c.id);
                const right = r?.readback === null || r?.readback === undefined ? null : r.readback === (c.outcome === "upheld");
                return (
                  <li key={c.id}>
                    <details className="group">
                      <summary className="grid cursor-pointer grid-cols-[76px_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[13.5px] hover:bg-paper sm:grid-cols-[76px_1fr_110px_120px_110px_90px]">
                        <span className="font-mono text-[12px] text-muted">{c.id}</span>
                        <span className="min-w-0">
                          <span className="font-medium">{byId.get(c.id)!.advertiser}</span>
                          <span className="text-muted"> · {c.product}</span>
                        </span>
                        <span className="sm:order-none">
                          <Badge tone={c.outcome === "upheld" ? "proof" : "moss"}>{c.outcome === "upheld" ? "Upheld" : "Not upheld"}</Badge>
                        </span>
                        <span className="hidden font-mono text-[12.5px] sm:inline">
                          {r ? r.runs.map((x) => (x === null ? "–" : x ? "F" : "p")).join(" ") : "not run"}
                        </span>
                        <span className="hidden text-[12.5px] sm:inline">Baseline: {flag(r?.baseline)}</span>
                        <span className="hidden text-[12.5px] sm:inline">
                          {right === null ? "" : right ? <span className="text-moss">Agrees</span> : <span className="text-proof">Disagrees</span>}
                        </span>
                      </summary>
                      <div className="flex flex-col gap-2 border-t border-rule bg-paper px-4 py-3 text-[13px] leading-relaxed">
                        <p><span className="text-muted">Claim: </span><span className="font-display text-[15px]">{c.claim_text}</span></p>
                        <p><span className="text-muted">Ruling: </span>{c.ruling_summary}</p>
                        {e && (
                          <p>
                            <span className="text-muted">Grounds (re-checked against the ruling): </span>
                            {e.grounds.map((g) => GROUND_LABEL[g] ?? g).join(", ") || "none given"}
                          </p>
                        )}
                        <p>
                          <span className="text-muted">Readback flagged: </span>
                          {r?.beliefs.length ? r.beliefs.join("; ") : r?.readback === false ? "nothing (every run passed or majority passed)" : "n/a"}
                        </p>
                        {e && (
                          <p>
                            <span className="text-muted">Evidence ASCI accepted: </span>
                            {e.ledger.length ? e.ledger.join(" · ") : "none"}
                            {l && <span className="text-muted"> · With this evidence Readback: {flag(l.readback)} (runs {l.runs.map((x) => (x === null ? "–" : x ? "F" : "p")).join(" ")}), baseline: {flag(l.baseline)}</span>}
                          </p>
                        )}
                        <a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 underline underline-offset-2">
                          Full ruling on ascionline.in <ExternalLink size={12} aria-hidden />
                        </a>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="method-h" className="flex flex-col gap-2 rounded-md border border-rule bg-sheet p-5 text-[13.5px] leading-relaxed">
            <h2 id="method-h" className="font-display text-[20px]">How it is scored, and its limits</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>A run flags a case when at least 2 of the 6 readers form a grounded belief that the fact judge finds contradicted or unsupported. The case verdict is the majority of three runs.</li>
              <li>The baseline asks one model call whether the ad is likely to be found misleading under the ASCI Code, at temperature 0.</li>
              <li>The rulings were picked by reading, not at random, from ASCI&apos;s public Complaint Outcomes database; most not-upheld cases are large brands with clinical or lab evidence. Grounds and accepted evidence were extracted from each ruling&apos;s full text with AI assistance and spot-checked by the participant.</li>
              <li>Readback sees only the claim text, not the ad&apos;s visuals, voice-over or packaging the panel saw, so implication cases are harder than in real use.</li>
              <li>Intervals are Wilson 95% intervals. With 66 and 34 cases, differences of a few points are within noise.</li>
              <li>Model: {plain?.model ?? "Gemini"} with automatic rotation on the free tier. Generated {plain?.generated_at?.slice(0, 10)}.</li>
            </ul>
          </section>
        </div>
      )}
    </Page>
  );
}
