"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { Role, Submission, SubmissionStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { canReview } from "@/components/format";
import { recordUrlAction, setStatusAction } from "@/app/app/s/[id]/actions";
import type { NumberedFinding } from "./DraftPane";

export function DecisionBar({
  submission,
  user,
  versionN,
  isLatest,
  items,
}: {
  submission: Submission;
  user: { id: string; role: Role };
  versionN: number;
  isLatest: boolean;
  items: NumberedFinding[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "approve" | "changes" | "url">("none");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reviewer = canReview(user.role);
  const s = submission.status;
  const openHigh = items.filter((i) => i.f.severity === "high" && i.f.status === "open").length;
  const disputed = items.filter((i) => i.f.status === "disputed").length;
  const isAuthor = user.id === submission.author_id;

  function act(status: SubmissionStatus, n?: string) {
    setError(null);
    start(async () => {
      const r = await setStatusAction(submission.id, status, n);
      if (!r.ok) return setError(r.error);
      setMode("none");
      setNote("");
      router.refresh();
    });
  }

  function saveUrl() {
    setError(null);
    start(async () => {
      const r = await recordUrlAction(submission.id, url);
      if (!r.ok) return setError(r.error);
      setMode("none");
      router.refresh();
    });
  }

  const canSend = (s === "draft" || s === "changes_requested") && (isAuthor || user.role === "creator" || user.role === "agency");
  const canDecide = reviewer && isLatest && (s === "in_review" || s === "changes_requested" || s === "draft");

  return (
    <div className="flex w-full max-w-[420px] flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {canSend && isLatest && (
          <Button variant="primary" disabled={pending} onClick={() => act("in_review")}>
            Send v{versionN} for review
          </Button>
        )}
        {canDecide && (
          <>
            <Button variant="danger" disabled={pending} onClick={() => setMode(mode === "changes" ? "none" : "changes")} aria-expanded={mode === "changes"}>
              Request changes
            </Button>
            <Button variant="approve" disabled={pending} onClick={() => setMode(mode === "approve" ? "none" : "approve")} aria-expanded={mode === "approve"}>
              Approve v{versionN}
            </Button>
          </>
        )}
        {!reviewer && s === "in_review" && (
          <p className="max-w-[34ch] text-right text-[12.5px] text-muted">
            Waiting on a reviewer. Only reviewers and the brand owner can approve.
          </p>
        )}
        {s === "approved" && (
          <Button variant="secondary" disabled={pending} onClick={() => setMode(mode === "url" ? "none" : "url")} aria-expanded={mode === "url"}>
            Record published URL
          </Button>
        )}
        {submission.published_url && (
          <a
            href={submission.published_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] underline underline-offset-4"
          >
            Live post <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </div>

      {mode === "approve" && (
        <form
          className="flex w-full flex-col gap-2 rounded-md border border-moss/40 bg-sheet p-3 sm:w-[380px]"
          onSubmit={(e) => {
            e.preventDefault();
            act("approved", note);
          }}
        >
          {openHigh > 0 && (
            <p className="text-[12.5px] text-proof">
              {openHigh} high-severity finding{openHigh === 1 ? " is" : "s are"} still open. Approving records{" "}
              {openHigh === 1 ? "it" : "them"} as accepted risk in the audit log.
            </p>
          )}
          {disputed > 0 && <p className="text-[12.5px] text-ochre">{disputed} disputed finding{disputed === 1 ? "" : "s"} on this version.</p>}
          <label htmlFor="approve-note" className="text-[12.5px] text-muted">
            Note for the record (optional). The audit entry also stores the fact versions this draft relies on.
          </label>
          <Textarea id="approve-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="approve" disabled={pending}>
              {pending ? "Approving" : `Approve v${versionN}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "changes" && (
        <form
          className="flex w-full flex-col gap-2 rounded-md border border-proof/40 bg-sheet p-3 sm:w-[380px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) act("changes_requested", note);
          }}
        >
          <label htmlFor="changes-note" className="text-[12.5px] text-muted">
            What should the author change? They see this note on the draft.
          </label>
          <Textarea
            id="changes-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Drop the 7-day claim or cite F-07 with its week-4 timing."
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" disabled={pending || !note.trim()}>
              {pending ? "Sending" : "Request changes"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "url" && (
        <form
          className="flex w-full flex-col gap-2 rounded-md border border-rule-strong bg-sheet p-3 sm:w-[380px]"
          onSubmit={(e) => {
            e.preventDefault();
            saveUrl();
          }}
        >
          <label htmlFor="pub-url" className="text-[12.5px] text-muted">
            Link to the live post. If a fact it cites changes later, this post appears in the Recall queue.
          </label>
          <Input id="pub-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/..." autoFocus />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending || !url.trim()}>
              {pending ? "Recording" : "Record URL"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-proof sm:text-right">
          {error}
        </p>
      )}
    </div>
  );
}
