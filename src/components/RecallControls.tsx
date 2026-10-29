"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { checkLiveAction, closeRecallAction, recallAction } from "@/app/app/recall/actions";

/** Per-recall actions: check the live page now, close by hand (reviewers), or mark the post recalled. */
export function RecallControls({
  submissionId, factCode, hasUrl, reviewer,
}: {
  submissionId: string; factCode: string; hasUrl: boolean; reviewer: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"check" | "close" | "recall" | null>(null);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function run(kind: "check" | "close" | "recall", fn: () => Promise<{ ok: boolean; error?: string; text?: string }>) {
    setBusy(kind);
    setMsg(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setMsg({ tone: "err", text: r.error ?? "That did not work. Try again." });
      else {
        if (r.text) setMsg({ tone: "ok", text: r.text });
        setClosing(false);
        router.refresh();
      }
    });
  }

  const check = () =>
    run("check", async () => {
      const r = await checkLiveAction(submissionId, factCode);
      if (!r.ok) return r;
      const c = r.check!;
      const text =
        c.outcome === "removed" ? "The claim is gone from the live page. The recall closed itself."
        : c.outcome === "still_live" ? "The stale claim is still on the live page."
        : `Could not confirm: ${c.error ?? "the page did not load"}.`;
      return { ok: true, text };
    });

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {hasUrl && (
          <Button size="sm" onClick={check} disabled={pending}>
            {busy === "check" ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : <RefreshCw size={13} aria-hidden />}
            {busy === "check" ? "Checking the page" : "Check live page now"}
          </Button>
        )}
        {reviewer && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setClosing((c) => !c)} aria-expanded={closing} disabled={pending}>
              Close as fixed
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => run("recall", async () => (await recallAction(submissionId, factCode), { ok: true }))}
            >
              {busy === "recall" ? "Recalling" : "Mark recalled"}
            </Button>
          </>
        )}
      </div>
      {closing && (
        <form
          className="flex w-full flex-col gap-2 rounded-md border border-rule-strong bg-sheet p-3 sm:w-[340px]"
          onSubmit={(e) => {
            e.preventDefault();
            run("close", () => closeRecallAction(submissionId, factCode, note));
          }}
        >
          <label htmlFor={`close-${submissionId}-${factCode}`} className="text-[12.5px] text-muted">
            How was the post fixed? This goes in the audit log.
          </label>
          <Textarea
            id={`close-${submissionId}-${factCode}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Agency updated the Nykaa banner on 29 Oct; screenshot in the campaign folder."
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="approve" disabled={pending || !note.trim()}>
              {busy === "close" ? "Closing" : "Close recall"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-[12.5px] text-proof sm:text-right" : "text-[12.5px] text-moss sm:text-right"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
