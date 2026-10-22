import type { CheckSummary } from "@/lib/types";

export function SummaryStrip({ summary, ruleMs }: { summary: CheckSummary; ruleMs: number | null }) {
  const cells: { label: string; value: React.ReactNode; tone?: string }[] = [
    { label: "Rule findings", value: summary.rule_count },
    { label: "Reader findings", value: summary.ai_count },
    { label: "High severity", value: summary.high, tone: summary.high > 0 ? "text-proof" : undefined },
    {
      label: "Got the intended takeaway",
      value: `${summary.intent_kept} of ${summary.of}`,
      tone: summary.of > 0 && summary.intent_kept / summary.of <= 0.5 ? "text-proof" : undefined,
    },
    { label: "Masked before model calls", value: summary.masked_tokens },
    {
      label: summary.mode === "mock" ? "Mock run" : "Model",
      value: <span className="font-mono text-[13px]">{summary.mode === "mock" ? "offline" : summary.model}</span>,
    },
    {
      label: ruleMs !== null ? `Total, rules took ${ruleMs} ms` : "Total time",
      value: `${(summary.ms_total / 1000).toFixed(1)} s`,
    },
  ];
  return (
    <dl className="mt-4 flex flex-wrap overflow-hidden rounded-md border border-rule bg-sheet">
      {cells.map((c) => (
        <div key={c.label} className="min-w-[150px] flex-1 border-r border-b border-rule px-4 py-2.5 -mb-px last:border-r-0">
          <dt className="text-[12px] text-muted">{c.label}</dt>
          <dd className={`mt-0.5 font-display text-[22px] leading-tight tabular-nums ${c.tone ?? ""}`}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}
