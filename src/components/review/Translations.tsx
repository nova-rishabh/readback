import Link from "next/link";
import { Languages, Plus } from "lucide-react";
import type { CheckSummary, Lang, LinkedSubmission } from "@/lib/types";
import { LANG_NAME, LANG_TAG } from "@/lib/lang";
import { StatusPill } from "@/components/ui/Badge";
import { DriftTable } from "@/components/DriftTable";

/** On a translation: which master it translates, and what readers believe from each, row by row. */
export function MasterComparison({
  master, drift, lang, checked,
}: {
  master: (LinkedSubmission & { version: number; body: string }) | null;
  drift: CheckSummary["drift"] | undefined;
  lang: Lang;
  checked: boolean;
}) {
  const changed = drift && master && drift.master_version !== master.version;
  const flagged = drift?.rows.filter((r) => r.kind === "new_belief" || r.kind === "strengthened" || (r.kind === "dropped" && (r.master?.strength ?? 2) <= 1)).length ?? 0;
  return (
    <section aria-labelledby="master-h" className="flex flex-col gap-3 rounded-md border border-rule bg-sheet px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="master-h" className="flex items-center gap-2 font-display text-[19px]">
          <Languages size={17} aria-hidden /> {LANG_NAME[lang]} translation
        </h2>
        {master && (
          <Link href={`/app/s/${master.id}`} className="text-[13px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            English master #{master.number}: {master.title}
          </Link>
        )}
      </div>
      {!master ? (
        <p className="text-[13.5px] text-muted">The English master of this translation is no longer available.</p>
      ) : (
        <>
          <details className="text-[13.5px]">
            <summary className="cursor-pointer text-muted hover:text-ink">
              English master copy (v{master.version}) <StatusPill status={master.status} />
            </summary>
            <p className="mt-2 whitespace-pre-wrap rounded-[4px] border border-rule bg-paper px-3 py-2 font-display text-[16px] leading-relaxed">
              {master.body}
            </p>
          </details>
          {changed && (
            <p className="rounded-[4px] border border-ochre/40 bg-ochre-tint px-3 py-2 text-[13px]">
              The English master changed since this check (compared with v{drift!.master_version}, now v{master.version}). Run the
              check again to compare with the current master.
            </p>
          )}
        </>
      )}
      {!checked ? (
        <p className="text-[13.5px] text-muted">
          Every check of a translation also compares it with its English master. Run the check to see the comparison.
        </p>
      ) : !drift ? (
        <p className="text-[13.5px] text-muted">This version was checked before it was linked to a master. Run the check again to compare.</p>
      ) : drift.failed ? (
        <p className="rounded-[4px] border border-ochre/40 bg-ochre-tint px-3 py-2 text-[13px]">
          The comparison with the master did not finish: {drift.failed}. Run the check again.
        </p>
      ) : (
        <>
          <p className="text-[13.5px]">
            {flagged
              ? `${flagged} belief${flagged > 1 ? "s" : ""} in this translation ${flagged > 1 ? "go" : "goes"} beyond the English master. Each one is a finding below (clause G-13) that must be fixed or disputed before approval.`
              : "Readers come away with the same beliefs from both versions. Nothing was added or made stronger in translation."}
          </p>
          {drift.rows.length > 0 && <DriftTable rows={drift.rows} of={drift.of} lang={lang} compact />}
        </>
      )}
    </section>
  );
}

/** On an English master: its translations, how each stands, and a way to add one. */
export function TranslationList({ masterId, variants, canAdd }: { masterId: string; variants: LinkedSubmission[]; canAdd: boolean }) {
  return (
    <section aria-labelledby="variants-h" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="variants-h" className="font-display text-[20px]">Translations</h2>
        {canAdd && (
          <Link
            href={`/app/new?master=${masterId}`}
            className="inline-flex items-center gap-1 text-[13px] font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
          >
            <Plus size={13} aria-hidden /> Add a translation
          </Link>
        )}
      </div>
      {variants.length === 0 ? (
        <p className="rounded-md border border-dashed border-rule-strong px-4 py-3 text-[13.5px] text-muted">
          No translations yet. A Hindi, Hinglish, Tamil or Marathi version added here is compared with this English copy on
          every check, so a translation cannot quietly promise more than the original.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule rounded-md border border-rule bg-sheet">
          {variants.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13.5px]">
              <span className="font-mono text-[12px] text-muted">#{v.number}</span>
              <Link href={`/app/s/${v.id}`} lang={LANG_TAG[v.lang]} className="min-w-0 flex-1 truncate font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                {v.title}
              </Link>
              <span className="text-[12.5px] text-muted">{LANG_NAME[v.lang]}</span>
              <StatusPill status={v.status} />
              <span className="w-full text-[12.5px] text-muted">
                {v.flagged === null ? "Not checked yet" : v.flagged === 0 ? "No open translation drift" : `${v.flagged} open translation drift finding${v.flagged > 1 ? "s" : ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
