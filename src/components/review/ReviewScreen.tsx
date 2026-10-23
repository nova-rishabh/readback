"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Lock, RotateCw, TriangleAlert } from "lucide-react";
import type { AuditEntry, Clause, Comment, Fact, Finding, Persona, Role, Span, Submission, Version } from "@/lib/types";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { channelLabel, langLabel, roleLabel } from "@/components/format";
import { useCheckStream } from "./useCheckStream";
import { DraftPane, MarkLegend, locateSpan, type NumberedFinding } from "./DraftPane";
import { FindingCard } from "./FindingCard";
import { ReaderPanel, StageTrack } from "./ReaderPanel";
import { Comments, History } from "./Comments";
import { DecisionBar } from "./DecisionBar";
import { SummaryStrip } from "./SummaryStrip";
import { saveVersionAction, updateFindingAction } from "@/app/app/s/[id]/actions";

type Override = Partial<Pick<Finding, "status" | "dispute_note">>;

function applyFixes(text: string, items: NumberedFinding[], replacements: Record<string, string>) {
  const fixes = items
    .filter((i) => i.span && replacements[i.f.id] !== undefined)
    .sort((a, b) => b.span!.start - a.span!.start);
  let out = text;
  let floor = Infinity;
  let applied = 0;
  for (const fx of fixes) {
    if (fx.span!.end > floor) continue; // overlaps a fix already applied
    out = out.slice(0, fx.span!.start) + replacements[fx.f.id] + out.slice(fx.span!.end);
    floor = fx.span!.start;
    applied++;
  }
  return { text: out, applied, skipped: fixes.length - applied };
}

export function ReviewScreen(props: {
  submission: Submission;
  versions: { id: string; n: number; created_at: string }[];
  current: Version;
  previous: Version | null;
  isLatest: boolean;
  comments: Comment[];
  audit: AuditEntry[];
  user: { id: string; name: string; role: Role; email: string };
  personas: Persona[];
  clauses: Clause[];
  facts: Fact[];
  imageUrl: string | null;
  autoRun: boolean;
}) {
  const { submission, current, previous, isLatest, user } = props;
  const router = useRouter();
  const { state, run } = useCheckStream(current.id, submission.id, () => router.refresh());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string | null>>({});
  const [showDiff, setShowDiff] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Span | null>(null);

  // Kick off the check once on arrival when asked to (new draft, new version, or never checked).
  const autoRan = useRef(false);
  useEffect(() => {
    if (!props.autoRun || autoRan.current) return;
    autoRan.current = true;
    void run();
    const url = new URL(window.location.href);
    if (url.searchParams.has("run")) {
      url.searchParams.delete("run");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    // Strict Mode unmounts once in dev and the stream hook aborts on unmount; allow the remount to start it again.
    return () => {
      autoRan.current = false;
    };
  }, [props.autoRun, run]);

  const live = state.status !== "idle";
  const running = state.status === "running";
  const base: Finding[] = useMemo(
    () => (live ? [...(state.ruleFindings ?? []), ...(state.aiFindings ?? [])] : current.findings),
    [live, state.ruleFindings, state.aiFindings, current.findings],
  );

  const items: NumberedFinding[] = useMemo(() => {
    const merged = base.map((f) => ({ ...f, ...overrides[f.id] }) as Finding);
    const located = merged.map((f, idx) => ({ f, idx, span: locateSpan(current.body, f.span) }));
    located.sort((a, b) => {
      const as = a.span ? a.span.start : Number.MAX_SAFE_INTEGER;
      const bs = b.span ? b.span.start : Number.MAX_SAFE_INTEGER;
      if (as !== bs) return as - bs;
      if (a.f.engine !== b.f.engine) return a.f.engine === "rule" ? -1 : 1;
      return a.idx - b.idx;
    });
    return located.map((l, i) => ({ f: l.f, n: i + 1, span: l.span }));
  }, [base, overrides, current.body]);

  const ruleItems = items.filter((i) => i.f.engine === "rule");
  const aiItems = items.filter((i) => i.f.engine === "ai");
  const imageItems = items.filter((i) => !i.span && (i.f.category === "accessibility" || i.f.category === "visual"));
  const factVersion = useMemo(() => new Map(props.facts.map((f) => [f.code, f.version])), [props.facts]);

  const summary = state.summary ?? (live ? null : current.summary);
  const terminal = ["approved", "published", "recalled"].includes(submission.status);
  const readOnly = running || !isLatest || terminal;
  const pendingFixes = items.filter((i) => i.span && replacements[i.f.id] !== undefined).length;

  const jump = useCallback((n: number) => {
    const el = document.getElementById(`finding-${n}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, []);

  async function persist(f: Finding, patch: Override, repl: string | null | undefined) {
    const prevOverride = overrides[f.id];
    const prevRepl = replacements[f.id];
    setOverrides((o) => ({ ...o, [f.id]: { ...o[f.id], ...patch } }));
    setReplacements((r) => {
      const next = { ...r };
      if (repl === null) delete next[f.id];
      else if (repl !== undefined) next[f.id] = repl;
      return next;
    });
    setBusy((b) => ({ ...b, [f.id]: true }));
    setCardErrors((e) => ({ ...e, [f.id]: null }));
    const r = await updateFindingAction(submission.id, current.id, f.id, patch);
    setBusy((b) => ({ ...b, [f.id]: false }));
    if (!r.ok) {
      setOverrides((o) => ({ ...o, [f.id]: prevOverride ?? {} }));
      setReplacements((rr) => {
        const next = { ...rr };
        if (prevRepl === undefined) delete next[f.id];
        else next[f.id] = prevRepl;
        return next;
      });
      setCardErrors((e) => ({ ...e, [f.id]: `Not saved: ${r.error}` }));
    }
  }

  async function saveNewVersion(body: string) {
    setSaving(true);
    setSaveError(null);
    const r = await saveVersionAction(submission.id, {
      body,
      image_path: current.image_path,
      image_alt: current.image_alt,
    });
    if (!r.ok) {
      setSaveError(r.error);
      setSaving(false);
      return;
    }
    router.push(`/app/s/${submission.id}?run=1`);
  }

  const nextN = props.versions[props.versions.length - 1].n + 1;
  const missingLocked = submission.locked_phrases.filter((p) => editing && !editText.toLowerCase().includes(p.toLowerCase()));

  function renderGroup(title: string, label: string, list: NumberedFinding[], empty: string) {
    return (
      <section aria-labelledby={`grp-${label}`} className="flex flex-col gap-2.5">
        <h2 id={`grp-${label}`} className="flex items-baseline gap-2 border-b border-rule pb-1.5">
          <span className="font-mono text-[12px] font-medium">[{label}]</span>
          <span className="font-display text-[18px]">{title}</span>
          <span className="ml-auto text-[12.5px] tabular-nums text-muted">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <p className="py-2 text-[13.5px] text-muted">{empty}</p>
        ) : (
          list.map((it) => (
            <FindingCard
              key={it.f.id}
              f={it.f}
              n={it.n}
              active={activeId === it.f.id}
              replacement={replacements[it.f.id] ?? null}
              factVersion={it.f.citation?.kind === "fact" ? (factVersion.get(it.f.citation.code) ?? null) : null}
              busy={!!busy[it.f.id]}
              error={cardErrors[it.f.id] ?? null}
              readOnly={readOnly}
              onHover={setActiveId}
              onAccept={() => {
                const s = it.f.suggestion;
                const usable = s && it.span && (s.reread === null || s.reread.passed);
                void persist(it.f, { status: "accepted" }, usable ? s!.replacement : undefined);
              }}
              onEdit={(t) => void persist(it.f, { status: "edited" }, t)}
              onDispute={(note) => void persist(it.f, { status: "disputed", dispute_note: note }, null)}
              onReopen={() => void persist(it.f, { status: "open" }, null)}
            />
          ))
        )}
      </section>
    );
  }

  const ruleEmpty = running && !state.ruleFindings ? "Running rule checks." : "No rule violations: terms, disclaimers, contrast, alt text and palette all pass.";
  const aiEmpty = running
    ? "Waiting for readers to report. Beliefs need at least 2 of 6 readers to become a finding."
    : "No belief was held by 2 or more readers that the Fact Ledger fails to support.";

  return (
    <div className="px-6 pt-6 pb-10 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-rule pb-4">
        <Link href="/app" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Inbox
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[14px] text-muted">#{submission.number}</span>
              <h1 className="font-display text-[30px] leading-tight tracking-[-0.01em]">{submission.title}</h1>
              <StatusPill status={submission.status} />
            </div>
            <p className="mt-1.5 text-[13.5px] text-muted">
              {channelLabel[submission.channel]}, {langLabel[submission.lang]}. By {submission.author_name} (
              {roleLabel[submission.author_role].toLowerCase()}).{" "}
              <span className="text-ink">Intended takeaway:</span> {submission.intent}
            </p>
            {submission.locked_phrases.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                <Lock size={12} aria-hidden /> Locked:
                {submission.locked_phrases.map((p) => (
                  <span key={p} className="rounded-[3px] border border-rule-strong px-1 font-mono text-[11.5px] text-ink">
                    {p}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div data-tour="decision">
          <DecisionBar submission={submission} user={user} versionN={current.n} isLatest={isLatest} items={items} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Versions" className="flex items-center gap-1">
            {props.versions.map((v) => {
              const isCur = v.id === current.id;
              return (
                <Link
                  key={v.id}
                  href={`/app/s/${submission.id}?v=${v.n}`}
                  aria-current={isCur ? "page" : undefined}
                  className={clsx(
                    "inline-flex h-8 items-center rounded-[5px] border px-3 font-mono text-[12.5px]",
                    isCur ? "border-ink bg-ink text-sheet" : "border-rule-strong bg-sheet hover:border-ink",
                  )}
                >
                  v{v.n}
                </Link>
              );
            })}
            {previous && (
              <label className="ml-3 inline-flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={showDiff}
                  onChange={(e) => setShowDiff(e.target.checked)}
                  className="size-4 accent-ink"
                />
                Show word changes from v{previous.n}
              </label>
            )}
            {!isLatest && <span className="ml-3 text-[12.5px] text-muted">Older version, read-only.</span>}
          </nav>
          {isLatest && (
            <Button size="sm" variant="ghost" onClick={() => void run()} disabled={running}>
              <RotateCw size={14} aria-hidden className={running ? "animate-spin" : undefined} />
              {running ? "Checking" : "Run check again"}
            </Button>
          )}
        </div>

        {live && <StageTrack state={state} />}
      </div>

      {summary?.mode === "mock" && (
        <p className="mt-4 rounded-md border border-steel/40 bg-steel-tint px-4 py-2.5 text-[13.5px]">
          <span className="font-medium">Mock readers.</span> No model was called. Reader beliefs come from fixed text cues so
          the demo runs offline; rule findings are real.
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-proof/40 bg-proof-tint px-4 py-2.5 text-[13.5px]">
          <span className="flex items-start gap-2">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-proof" />
            <span>
              <span className="font-medium text-proof">The check did not finish.</span> {state.error} Findings that arrived
              before it stopped are saved.
            </span>
          </span>
          <Button size="sm" variant="danger" onClick={() => void run()}>
            Run again
          </Button>
        </div>
      )}
      {!live && !current.summary && current.findings.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ochre/40 bg-ochre-tint px-4 py-2.5 text-[13.5px]">
          <span>
            <span className="font-medium">Partial check.</span> The last run stopped before it finished; the findings below are
            the ones it saved. Run the check again for the complete reader panel and fixes.
          </span>
          <Button size="sm" onClick={() => void run()}>
            Run check again
          </Button>
        </p>
      )}
      {summary && <SummaryStrip summary={summary} ruleMs={state.ruleMs} />}

      {/* Three columns at xl, two at lg, stacked below */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.1fr)_minmax(0,0.8fr)]">
        {/* Left: the draft */}
        <div data-tour="draft" className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-md border border-rule bg-sheet">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-2.5">
              <h2 className="text-[13px] font-medium">
                Draft <span className="font-mono text-muted">v{current.n}</span>
                {showDiff && previous && <span className="font-normal text-muted"> compared with v{previous.n}</span>}
              </h2>
              {isLatest && !terminal && !editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  onClick={() => {
                    setEditText(applyFixes(current.body, items, replacements).text);
                    setEditing(true);
                    setShowDiff(false);
                  }}
                >
                  Edit copy
                </Button>
              )}
            </div>

            <div className="px-5 py-5">
              {editing ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor="edit-copy" className="text-[12.5px] text-muted">
                    Edit the copy directly. Saving creates v{nextN} and runs the check on it.
                  </label>
                  <Textarea
                    id="edit-copy"
                    rows={8}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="font-display text-[19px] leading-[1.65]"
                    autoFocus
                  />
                  {missingLocked.length > 0 && (
                    <p className="text-[12.5px] text-proof">Locked phrase missing: {missingLocked.join(", ")}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={saving || !editText.trim() || editText === current.body}
                      onClick={() => void saveNewVersion(editText)}
                    >
                      {saving ? "Saving" : `Save as v${nextN} and re-check`}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <DraftPane
                  text={current.body}
                  items={items}
                  activeId={activeId}
                  onActivate={setActiveId}
                  onJump={jump}
                  replacements={replacements}
                  diffAgainst={showDiff && previous ? previous.body : null}
                  onSelectSpan={setAnchor}
                />
              )}
            </div>

            {pendingFixes > 0 && !editing && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-moss-tint/50 px-5 py-3">
                <p className="text-[13px]">
                  {pendingFixes} accepted fix{pendingFixes === 1 ? "" : "es"} shown inline. Saving applies only those spans.
                </p>
                <Button
                  size="sm"
                  variant="approve"
                  disabled={saving}
                  onClick={() => {
                    const r = applyFixes(current.body, items, replacements);
                    void saveNewVersion(r.text);
                  }}
                >
                  {saving ? "Saving" : `Save as v${nextN}`}
                </Button>
              </div>
            )}
            {saveError && (
              <p role="alert" className="border-t border-rule px-5 py-2 text-[12.5px] text-proof">
                {saveError}
              </p>
            )}

            {(current.image_path || props.imageUrl) && (
              <figure className="border-t border-rule px-5 py-4">
                {props.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={props.imageUrl}
                    alt={current.image_alt ?? ""}
                    className="block max-h-[340px] w-full rounded-[4px] border border-rule object-contain"
                  />
                ) : (
                  <p className="rounded-[4px] border border-dashed border-rule-strong px-3 py-6 text-center text-[13px] text-muted">
                    The image could not be loaded. Its signed link may have expired; reload the page.
                  </p>
                )}
                <figcaption className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  {current.image_alt ? (
                    <>
                      <span className="text-ink">Alt text:</span> {current.image_alt}
                    </>
                  ) : (
                    <span className="text-proof">No alt text.</span>
                  )}
                  {imageItems.length > 0 && (
                    <span className="mt-1 block">
                      Image findings:{" "}
                      {imageItems.map((i, k) => (
                        <a
                          key={i.f.id}
                          href={`#finding-${i.n}`}
                          onClick={(e) => {
                            e.preventDefault();
                            jump(i.n);
                          }}
                          onMouseEnter={() => setActiveId(i.f.id)}
                          onMouseLeave={() => setActiveId(null)}
                          className="font-medium text-ink underline underline-offset-2"
                        >
                          {k > 0 ? ", " : ""}
                          {i.n} {i.f.title}
                        </a>
                      ))}
                    </span>
                  )}
                </figcaption>
              </figure>
            )}

            <div className="border-t border-rule px-5 py-3">
              <MarkLegend categories={items.filter((i) => i.span).map((i) => i.f.category)} />
            </div>
          </div>
        </div>

        {/* Middle: findings */}
        <div data-tour="findings" className="flex flex-col gap-8">
          {!live && items.length === 0 && !current.summary ? (
            <div className="rounded-md border border-dashed border-rule-strong px-5 py-8 text-center text-[14px] text-muted">
              This version has not been checked yet.
              {isLatest && (
                <div className="mt-3">
                  <Button variant="primary" size="sm" onClick={() => void run()}>
                    Run the check
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              {renderGroup("Rule engine", "RULE", ruleItems, ruleEmpty)}
              {renderGroup("Impression engine", "AI", aiItems, aiEmpty)}
            </>
          )}
        </div>

        {/* Right: readers and comments */}
        <div className="flex flex-col gap-8 lg:col-span-2 lg:grid lg:grid-cols-2 xl:col-span-1 xl:flex">
          <div data-tour="readers"><ReaderPanel personas={props.personas} state={state} onRun={() => void run()} canRun={isLatest} /></div>
          <div className="flex flex-col gap-8">
            <Comments
              submissionId={submission.id}
              versionN={current.n}
              comments={props.comments}
              anchor={anchor}
              onClearAnchor={() => {
                setAnchor(null);
                window.getSelection()?.removeAllRanges();
              }}
            />
            <History audit={props.audit} />
          </div>
        </div>
      </div>
    </div>
  );
}
