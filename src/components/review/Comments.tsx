"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { AuditEntry, Comment, Span } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { addCommentAction } from "@/app/app/s/[id]/actions";
import { fmtDateTime, roleLabel } from "@/components/format";

export function Comments({
  submissionId,
  versionN,
  comments,
  anchor,
  onClearAnchor,
}: {
  submissionId: string;
  versionN: number;
  comments: Comment[];
  anchor: Span | null;
  onClearAnchor: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));

  function submit() {
    setError(null);
    start(async () => {
      const r = await addCommentAction(submissionId, versionN, body, anchor);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBody("");
      onClearAnchor();
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="comments-h" className="flex flex-col gap-3">
      <h2 id="comments-h" className="font-display text-[20px]">
        Comments <span className="font-sans text-[13px] text-muted tabular-nums">{comments.length}</span>
      </h2>
      {sorted.length === 0 ? (
        <p className="text-[13.5px] text-muted">No comments yet. Select words in the draft to anchor a note to them.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {sorted.map((c) => (
            <li key={c.id} className="border-b border-rule pb-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <span className="font-medium text-ink">{c.author_name}</span>
                <span className="text-muted">{roleLabel[c.author_role]}</span>
                <span className="font-mono text-[11px] text-muted">v{c.version_n}</span>
                <span className="ml-auto tabular-nums text-muted">{fmtDateTime(c.created_at)}</span>
              </div>
              {c.anchor && (
                <blockquote className="mt-1 border-l-2 border-ochre/60 pl-2 font-display text-[14.5px] italic text-ink/80">
                  {c.anchor.text}
                </blockquote>
              )}
              <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) submit();
        }}
        className="flex flex-col gap-2"
      >
        {anchor ? (
          <div className="flex items-start gap-2 rounded-[5px] border border-ochre/40 bg-ochre-tint px-2.5 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1">
              Anchored to <span className="font-display text-[14px] italic">&ldquo;{anchor.text}&rdquo;</span>
            </span>
            <button type="button" onClick={onClearAnchor} aria-label="Remove anchor" className="rounded p-1.5 text-muted hover:text-ink">
              <X size={14} aria-hidden />
            </button>
          </div>
        ) : null}
        <label htmlFor="comment-body" className="sr-only">
          Add a comment on v{versionN}
        </label>
        <Textarea
          id="comment-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Comment on v${versionN}`}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) submit();
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted">Ctrl+Enter to post</span>
          <Button size="sm" type="submit" variant="secondary" disabled={pending || !body.trim()}>
            {pending ? "Posting" : "Post comment"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-proof">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

const actionText: Record<string, string> = {
  approved: "approved",
  requested_changes: "requested changes",
  changes_requested: "requested changes",
  submitted: "submitted",
  in_review: "sent for review",
  version_added: "saved a new version",
  published: "recorded the published URL",
  recalled: "recalled",
  check_run: "ran the check",
};

export function History({ audit }: { audit: AuditEntry[] }) {
  if (!audit.length) return null;
  const rows = [...audit].sort((a, b) => b.id - a.id).slice(0, 12);
  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-2">
      <h2 id="history-h" className="font-display text-[18px]">
        History
      </h2>
      <ol className="flex flex-col text-[12.5px]">
        {rows.map((a) => (
          <li key={a.id} className="grid grid-cols-[1fr_auto] gap-x-2 border-b border-rule py-1.5 last:border-b-0">
            <span>
              <span className="font-medium">{a.actor_name}</span> {actionText[a.action] ?? a.action.replace(/_/g, " ")}
              {a.fact_versions && Object.keys(a.fact_versions).length > 0 && (
                <span className="text-muted">
                  {" "}
                  citing{" "}
                  {Object.entries(a.fact_versions).map(([k, v], i) => (
                    <span key={k} className="font-mono text-[11px]">
                      {i > 0 ? ", " : ""}
                      {k} v{v}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="tabular-nums text-muted">{fmtDateTime(a.created_at)}</span>
            <span className="col-span-2 font-mono text-[10.5px] text-muted" title={a.hash}>
              {a.hash.slice(0, 12)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
