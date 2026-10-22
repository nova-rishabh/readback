"use client";

import { clsx } from "clsx";
import { forwardRef, useState } from "react";
import { Check, CircleAlert, Pencil, Flag, Undo2 } from "lucide-react";
import type { Finding } from "@/lib/types";
import { Badge, SeverityBadge, VerdictBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { BeliefMeter } from "./BeliefMeter";
import { CitationChip } from "./CitationChip";
import { categoryLabel } from "@/components/format";

const sevBorder = { high: "border-l-proof", medium: "border-l-ochre", low: "border-l-steel" } as const;
const sevMeter = { high: "proof", medium: "ochre", low: "steel" } as const;

export interface FindingCardProps {
  f: Finding;
  n: number;
  active: boolean;
  replacement: string | null;
  factVersion: number | null;
  busy: boolean;
  error: string | null;
  readOnly: boolean;
  onHover: (id: string | null) => void;
  onAccept: () => void;
  onEdit: (text: string) => void;
  onDispute: (note: string) => void;
  onReopen: () => void;
}

function Measured({ m }: { m: Record<string, string | number> }) {
  const ratio = m.ratio !== undefined ? Number(m.ratio) : null;
  const fg = typeof m.fg === "string" ? m.fg : null;
  const bg = typeof m.bg === "string" ? m.bg : null;
  if (ratio !== null && fg && bg) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[5px] border border-rule bg-paper px-3 py-2 text-[13px]">
        <span
          className="inline-flex h-7 items-center rounded-[3px] border border-rule-strong px-2 font-display text-[15px]"
          style={{ color: fg, background: bg }}
          aria-hidden
        >
          Aa
        </span>
        <span>
          Measured <span className="font-mono font-medium tabular-nums">{ratio.toFixed(2)}:1</span>
          {m.required !== undefined && (
            <>
              , needs <span className="font-mono tabular-nums">{String(m.required)}:1</span>
            </>
          )}
        </span>
        <span className="font-mono text-[11.5px] text-muted">
          text {fg} on {bg}
        </span>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-[5px] border border-rule bg-paper px-3 py-2 text-[12.5px]">
      {Object.entries(m).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RereadLine({ s }: { s: NonNullable<Finding["suggestion"]> }) {
  const r = s.reread;
  if (!r) return <p className="text-[12.5px] text-muted">Replacement from the brand term list. No re-read needed.</p>;
  if (r.passed) {
    return (
      <p className="flex items-start gap-1.5 text-[12.5px] text-moss">
        <Check size={14} aria-hidden className="mt-px shrink-0" />
        <span>
          Re-read passed: unsupported beliefs {r.unsupported_before} to {r.unsupported_after}, no new ones, intent kept by{" "}
          {r.intent_kept} of {r.of} readers.
        </span>
      </p>
    );
  }
  const why =
    r.new_unsupported > 0
      ? `the rewrite created ${r.new_unsupported} new unsupported belief${r.new_unsupported === 1 ? "" : "s"}`
      : r.unsupported_after >= r.unsupported_before
        ? `unsupported beliefs did not drop (${r.unsupported_before} to ${r.unsupported_after})`
        : `only ${r.intent_kept} of ${r.of} readers still got the intended takeaway`;
  return (
    <p className="flex items-start gap-1.5 text-[12.5px] text-proof">
      <CircleAlert size={14} aria-hidden className="mt-px shrink-0" />
      <span>No safe fix found: {why}. Rewrite this line by hand.</span>
    </p>
  );
}

const statusText: Record<Finding["status"], string | null> = {
  open: null,
  accepted: "Fix accepted",
  edited: "Edited fix accepted",
  disputed: "Disputed",
  dismissed: "Dismissed",
};

export const FindingCard = forwardRef<HTMLElement, FindingCardProps>(function FindingCard(props, ref) {
  const { f, n, active, replacement, factVersion, busy, error, readOnly } = props;
  const [mode, setMode] = useState<"none" | "edit" | "dispute">("none");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(f.dispute_note ?? "");

  const sug = f.suggestion;
  const usable = sug && f.span && (sug.reread === null || sug.reread.passed);
  const resolved = f.status !== "open";
  const b = f.belief;

  return (
    <article
      ref={ref}
      id={`finding-${n}`}
      tabIndex={-1}
      aria-labelledby={`finding-${n}-title`}
      onMouseEnter={() => props.onHover(f.id)}
      onMouseLeave={() => props.onHover(null)}
      onFocus={() => props.onHover(f.id)}
      className={clsx(
        "rb-arrive scroll-mt-28 rounded-md border border-l-[3px] bg-sheet px-4 py-3.5 transition-colors outline-none",
        sevBorder[f.severity],
        active ? "border-rule-strong border-y-ink/40 border-r-ink/40 bg-white" : "border-rule",
        resolved && "opacity-75",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display text-[17px] leading-none font-semibold tabular-nums" aria-label={`Finding ${n}`}>
          {n}
        </span>
        <span className="font-mono text-[11.5px] font-medium">{f.engine === "rule" ? "[RULE]" : "[AI]"}</span>
        {f.engine === "ai" && f.model && <span className="font-mono text-[11px] text-muted">{f.model}</span>}
        <span className="text-[12.5px] text-muted">{categoryLabel[f.category]}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {statusText[f.status] && (
            <Badge tone={f.status === "disputed" ? "ochre" : "moss"}>{statusText[f.status]}</Badge>
          )}
          <SeverityBadge severity={f.severity} />
        </span>
      </header>

      <h3 id={`finding-${n}-title`} className="mt-2 text-[15px] leading-snug font-semibold">
        {f.title}
      </h3>

      {b && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="font-display text-[16px] leading-snug">
            <span className="font-sans text-[13px] text-muted">
              {b.readers} of {b.of} readers believed:{" "}
            </span>
            &ldquo;{b.statement}&rdquo;
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <BeliefMeter k={b.readers} of={b.of} tone={sevMeter[f.severity]} />
            <VerdictBadge verdict={b.verdict} factCode={b.fact_code} split={`${b.readers} / ${b.of - b.readers}`} />
            {b.visual_element && <span className="text-[12.5px] text-muted">From the image: {b.visual_element}</span>}
          </div>
          {b.reader_names.length > 0 && (
            <p className="text-[12px] text-muted">{b.reader_names.join(", ")}</p>
          )}
        </div>
      )}

      <p className="mt-2 text-[14px] leading-relaxed text-ink/85">{f.explanation}</p>

      {f.measured && Object.keys(f.measured).length > 0 && (
        <div className="mt-2.5">
          <Measured m={f.measured} />
        </div>
      )}

      {f.citation && (
        <div className="mt-2.5">
          <CitationChip citation={f.citation} version={f.citation.kind === "fact" ? factVersion : null} />
        </div>
      )}

      {sug && f.span && (
        <div className="mt-3 border-l-2 border-rule-strong pl-3">
          <p className="text-[13.5px] leading-relaxed">
            <span className="text-muted">Replace </span>
            <span className="diff-del font-display text-[15px]">{f.span.text}</span>
            <span className="text-muted"> with </span>
            <span className="diff-add font-display text-[15px]">{sug.replacement}</span>
          </p>
          {sug.rationale && <p className="mt-1 text-[12.5px] text-muted">{sug.rationale}</p>}
          <div className="mt-1.5">
            <RereadLine s={sug} />
          </div>
        </div>
      )}

      {replacement !== null && f.status === "edited" && (
        <p className="mt-2 text-[13px]">
          <span className="text-muted">Your wording: </span>
          <span className="diff-add font-display text-[15px]">{replacement}</span>
        </p>
      )}
      {f.status === "disputed" && f.dispute_note && (
        <p className="mt-2 text-[13px]">
          <span className="text-muted">Dispute note: </span>
          {f.dispute_note}
        </p>
      )}

      {!readOnly && (
        <>
          {mode === "none" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {resolved ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={props.onReopen}>
                  <Undo2 size={14} aria-hidden /> Reopen
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={props.onAccept}
                    title={usable ? "Apply this fix when you save the next version" : "Mark as accepted; you will change the copy yourself"}
                  >
                    <Check size={14} aria-hidden /> {usable ? "Accept fix" : "Accept"}
                  </Button>
                  {f.span && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setDraft(sug?.replacement ?? f.span!.text);
                        setMode("edit");
                      }}
                    >
                      <Pencil size={14} aria-hidden /> Edit
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("dispute")}>
                    <Flag size={14} aria-hidden /> Dispute
                  </Button>
                </>
              )}
            </div>
          )}

          {mode === "edit" && f.span && (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                props.onEdit(draft.trim());
                setMode("none");
              }}
            >
              <label className="text-[12.5px] text-muted" htmlFor={`edit-${f.id}`}>
                New wording for &ldquo;{f.span.text}&rdquo;. Only this span changes.
              </label>
              <Textarea
                id={`edit-${f.id}`}
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="font-display text-[16px]"
              />
              <div className="flex gap-2">
                <Button size="sm" type="submit" variant="primary" disabled={!draft.trim() || busy}>
                  Use this wording
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {mode === "dispute" && (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                props.onDispute(note.trim());
                setMode("none");
              }}
            >
              <label className="text-[12.5px] text-muted" htmlFor={`dispute-${f.id}`}>
                Why is this finding wrong? Reviewers see the note, and disputes count toward the clause&rsquo;s
                &ldquo;unclear&rdquo; score in Insights.
              </label>
              <Textarea
                id={`dispute-${f.id}`}
                autoFocus
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example: F-03 covers this; the study included dermatologist assessment."
              />
              <div className="flex gap-2">
                <Button size="sm" type="submit" variant="danger" disabled={!note.trim() || busy}>
                  File dispute
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-proof">
          {error}
        </p>
      )}
    </article>
  );
});
