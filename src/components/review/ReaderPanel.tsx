"use client";

import { clsx } from "clsx";
import { Check, LoaderCircle, X } from "lucide-react";
import type { Persona, ReaderResult } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { STAGES, type StreamState } from "./useCheckStream";

function ReaderCard({ name, builtin, result, waiting }: { name: string; builtin: boolean; result?: ReaderResult; waiting: boolean }) {
  if (!result) {
    return (
      <li className="rounded-md border border-dashed border-rule-strong px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13.5px] font-medium">{name}</p>
          <span className="text-[11.5px] text-muted">{builtin ? "built-in" : "brand persona"}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
          {waiting ? (
            <>
              <LoaderCircle size={12} className="animate-spin" aria-hidden /> Reading the draft and image
            </>
          ) : (
            "No report. The reader's answer failed validation twice and was dropped."
          )}
        </p>
      </li>
    );
  }
  const grounded = result.beliefs.filter((b) => b.grounded).length;
  const dropped = result.beliefs.length - grounded;
  return (
    <li className="rb-arrive rounded-md border border-rule bg-sheet px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13.5px] font-medium">{result.persona_name || name}</p>
        <span
          className={clsx("inline-flex items-center gap-1 text-[12px]", result.intent_match ? "text-moss" : "text-proof")}
        >
          {result.intent_match ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
          {result.intent_match ? "Got the takeaway" : "Missed the takeaway"}
        </span>
      </div>
      <p className="mt-1.5 font-display text-[15.5px] leading-snug">&ldquo;{result.takeaway}&rdquo;</p>
      <p className="mt-1.5 text-[12px] text-muted">
        {result.tone.length > 0 && <>Reads as {result.tone.join(", ")}. </>}
        {grounded} belief{grounded === 1 ? "" : "s"} kept
        {dropped > 0 && `, ${dropped} dropped as ungrounded`}.
      </p>
      {result.beliefs.length > 0 && (
        <details className="mt-1.5 text-[12.5px]">
          <summary className="cursor-pointer text-muted hover:text-ink">Beliefs and what triggered them</summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {result.beliefs.map((b, i) => (
              <li key={i} className={clsx("border-l-2 pl-2", b.grounded ? "border-rule-strong" : "border-rule line-through decoration-muted/60")}>
                {b.belief}
                <span className="block text-muted">
                  from &ldquo;{b.trigger_quote}&rdquo;
                  {b.visual_element ? ` and the image (${b.visual_element})` : ""}, confidence {Math.round(b.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function StageTrack({ state }: { state: StreamState }) {
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="Check progress">
      {STAGES.map((s) => {
        const reached = state.reached.includes(s.id);
        const current = state.status === "running" && state.stage === s.id;
        return (
          <li
            key={s.id}
            aria-current={current ? "step" : undefined}
            className={clsx("inline-flex items-center gap-1", current ? "text-ink font-medium" : reached ? "text-ink/70" : "text-muted/60")}
          >
            {current ? (
              <LoaderCircle size={11} className="animate-spin" aria-hidden />
            ) : reached ? (
              <Check size={11} aria-hidden />
            ) : (
              <span className="inline-block size-[5px] rounded-full bg-current" aria-hidden />
            )}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export function ReaderPanel({
  personas,
  state,
  onRun,
  canRun,
}: {
  personas: Persona[];
  state: StreamState;
  onRun: () => void;
  canRun: boolean;
}) {
  const slots: { id: string; name: string; builtin: boolean }[] =
    personas.length > 0
      ? [...personas].sort((a, b) => Number(a.builtin) - Number(b.builtin)).map((p) => ({ id: p.id, name: p.name, builtin: p.builtin }))
      : Array.from({ length: 6 }, (_, i) => ({ id: `slot-${i}`, name: `Reader ${i + 1}`, builtin: false }));
  const byId = new Map(state.readers.map((r) => [r.persona_id, r]));
  const extra = state.readers.filter((r) => !slots.some((s) => s.id === r.persona_id));
  // When persona ids don't line up (e.g. mock readers), fill empty slots in arrival order.
  const filled = slots.map((s) => byId.get(s.id) ?? null);
  for (let i = 0; i < filled.length && extra.length; i++) if (!filled[i]) filled[i] = extra.shift()!;

  const live = state.status !== "idle";
  const waiting = state.status === "running";
  const reported = state.readers.length;

  return (
    <section aria-labelledby="readers-h" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="readers-h" className="font-display text-[20px]">
          Reader panel
        </h2>
        {live && (
          <span className="text-[12.5px] tabular-nums text-muted" aria-live="polite">
            {reported} of {slots.length} reported
          </span>
        )}
      </div>

      {!live ? (
        <div className="rounded-md border border-dashed border-rule-strong px-4 py-4 text-[13.5px] leading-relaxed text-muted">
          Reader takeaways stream in during a live check and are not stored. The findings on this version were saved from an
          earlier run.
          {canRun && (
            <div className="mt-3">
              <Button size="sm" onClick={onRun}>
                Run the six readers again
              </Button>
            </div>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-live="polite" aria-busy={waiting}>
          {slots.map((s, i) => (
            <ReaderCard key={s.id} name={s.name} builtin={s.builtin} result={filled[i] ?? undefined} waiting={waiting} />
          ))}
          {extra.map((r) => (
            <ReaderCard key={r.persona_id} name={r.persona_name} builtin={false} result={r} waiting={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
