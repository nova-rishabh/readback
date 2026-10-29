import type { DriftKind, DriftRow, Lang } from "@/lib/types";
import { LANG_NAME, LANG_TAG } from "@/lib/lang";
import { Badge, type Tone } from "@/components/ui/Badge";

export const DRIFT_KIND: Record<DriftKind, { label: string; tone: Tone }> = {
  new_belief: { label: "Added in translation", tone: "proof" },
  strengthened: { label: "Made stronger", tone: "proof" },
  dropped: { label: "Dropped", tone: "ochre" },
  weakened: { label: "Weakened", tone: "steel" },
  same: { label: "Same", tone: "moss" },
};
const STRENGTH = ["", "hedged", "plain claim", "absolute"];

function Side({ s, of }: { s: DriftRow["master"]; of: number }) {
  if (!s) return <span className="text-[13px] text-muted">Not formed</span>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[14px]">{s.belief}</span>
      {s.quote && <span className="font-display text-[14px] italic text-muted">“{s.quote}”</span>}
      <span className="font-mono text-[11.5px] text-muted">
        {s.readers} of {of} readers · {STRENGTH[Math.min(3, Math.max(1, Math.round(s.strength)))]}
      </span>
    </div>
  );
}

/** Beliefs formed from the English master and from its translation, paired row by row. */
export function DriftTable({ rows, of, lang, compact = false }: { rows: DriftRow[]; of: number; lang: Lang; compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className={compact ? "w-full table-fixed border-collapse bg-sheet text-left [overflow-wrap:anywhere]" : "w-full min-w-[760px] border-collapse bg-sheet text-left"}>
        <caption className="sr-only">Beliefs formed from each version</caption>
        <thead>
          <tr className="border-b border-rule-strong text-[12.5px] text-muted">
            <th scope="col" className={compact ? "w-[30%] px-3 py-2 font-medium" : "w-[170px] px-4 py-2 font-medium"}>Change</th>
            <th scope="col" className="px-3 py-2 font-medium">English master</th>
            <th scope="col" className="px-3 py-2 font-medium">{LANG_NAME[lang]} version</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-rule align-top last:border-0">
              <td className="px-3 py-3">
                <Badge tone={DRIFT_KIND[r.kind].tone}>{DRIFT_KIND[r.kind].label}</Badge>
                <p className="mt-2 text-[12.5px] text-muted">{r.explanation}</p>
              </td>
              <td className="px-3 py-3"><Side s={r.master} of={of} /></td>
              <td className="px-3 py-3" lang={LANG_TAG[lang]}><Side s={r.variant} of={of} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
