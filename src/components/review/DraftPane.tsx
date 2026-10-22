"use client";

import { clsx } from "clsx";
import { diffWords } from "diff";
import { useMemo, useRef, type ReactNode } from "react";
import type { Finding, Severity, Span } from "@/lib/types";
import { categoryMark, categoryLabel } from "@/components/format";

export interface NumberedFinding {
  f: Finding;
  n: number;
  span: Span | null; // span relocated against the draft text (or null if it no longer matches)
}

const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const supColor: Record<Severity, string> = { high: "text-proof", medium: "text-ochre", low: "text-steel" };

/** Make sure a finding's span still points at its text; relocate by search when offsets drifted. */
export function locateSpan(text: string, span: Span | null): Span | null {
  if (!span) return null;
  if (span.start >= 0 && span.end <= text.length && span.end > span.start && text.slice(span.start, span.end) === span.text) {
    return span;
  }
  if (!span.text) return null;
  const idx = text.indexOf(span.text);
  if (idx >= 0) return { start: idx, end: idx + span.text.length, text: span.text };
  const lower = text.toLowerCase().indexOf(span.text.toLowerCase());
  if (lower >= 0) return { start: lower, end: lower + span.text.length, text: text.slice(lower, lower + span.text.length) };
  return null;
}

interface Segment {
  start: number;
  end: number;
  covering: NumberedFinding[];
}

function segment(text: string, items: NumberedFinding[]): Segment[] {
  const withSpan = items.filter((i) => i.span);
  const cuts = new Set<number>([0, text.length]);
  for (const i of withSpan) {
    cuts.add(i.span!.start);
    cuts.add(i.span!.end);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const segs: Segment[] = [];
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (a === b) continue;
    const covering = withSpan
      .filter((i) => i.span!.start <= a && i.span!.end >= b)
      .sort((x, y) => sevRank[x.f.severity] - sevRank[y.f.severity] || x.span!.end - x.span!.start - (y.span!.end - y.span!.start));
    segs.push({ start: a, end: b, covering });
  }
  return segs;
}

/** Character offset of a DOM selection point, using data-off markers on text-bearing elements. */
function offsetOf(node: Node | null, off: number): number | null {
  if (!node) return null;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const host = node.parentElement?.closest<HTMLElement>("[data-off]");
  if (!host || host.firstChild !== node) return null;
  return Number(host.dataset.off) + off;
}

export function DraftPane({
  text,
  items,
  activeId,
  onActivate,
  onJump,
  replacements,
  diffAgainst,
  onSelectSpan,
}: {
  text: string;
  items: NumberedFinding[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onJump: (n: number) => void;
  replacements: Record<string, string>;
  diffAgainst: string | null;
  onSelectSpan: (span: Span | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const segs = useMemo(() => segment(text, items), [text, items]);

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ref.current) return;
    if (!ref.current.contains(sel.anchorNode) || !ref.current.contains(sel.focusNode)) return;
    const a = offsetOf(sel.anchorNode, sel.anchorOffset);
    const b = offsetOf(sel.focusNode, sel.focusOffset);
    if (a === null || b === null) return;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const slice = text.slice(start, end);
    if (!slice.trim()) return;
    onSelectSpan({ start, end, text: slice });
  }

  if (diffAgainst !== null) {
    const parts = diffWords(diffAgainst, text);
    return (
      <div className="font-display text-[21px] leading-[1.75] whitespace-pre-wrap" aria-label="Word changes from the previous version">
        {parts.map((p, i) =>
          p.added ? (
            <ins key={i} className="diff-add no-underline">
              <span className="sr-only">inserted: </span>
              {p.value}
            </ins>
          ) : p.removed ? (
            <del key={i} className="diff-del">
              <span className="sr-only">removed: </span>
              {p.value}
            </del>
          ) : (
            <span key={i}>{p.value}</span>
          ),
        )}
      </div>
    );
  }

  const nodes: ReactNode[] = [];
  for (const s of segs) {
    const chunk = text.slice(s.start, s.end);
    const primary = s.covering[0];
    if (!primary) {
      nodes.push(
        <span key={s.start} data-off={s.start}>
          {chunk}
        </span>,
      );
      continue;
    }
    const isActive = s.covering.some((c) => c.f.id === activeId);
    const resolved = s.covering.every((c) => c.f.status !== "open");
    const repl = replacements[primary.f.id];
    const endsHere = s.covering.filter((c) => c.span!.end === s.end);
    nodes.push(
      <mark
        key={s.start}
        data-off={s.start}
        data-sev={primary.f.severity}
        data-active={isActive}
        data-resolved={resolved && repl === undefined}
        className={clsx("proof-mark text-ink", categoryMark[primary.f.category], repl !== undefined && "diff-del")}
        title={s.covering.map((c) => `${c.n}. ${c.f.title}`).join("\n")}
        onMouseEnter={() => onActivate(primary.f.id)}
        onMouseLeave={() => onActivate(null)}
        onClick={() => {
          if (window.getSelection()?.isCollapsed !== false) onJump(primary.n);
        }}
      >
        {chunk}
      </mark>,
    );
    for (const c of endsHere) {
      const r = replacements[c.f.id];
      if (r !== undefined) {
        nodes.push(
          <ins key={`ins-${c.f.id}`} className="diff-add mx-0.5 no-underline select-none">
            <span className="sr-only">replacement: </span>
            {r}
          </ins>,
        );
      }
      nodes.push(
        <a
          key={`sup-${c.f.id}`}
          href={`#finding-${c.n}`}
          aria-label={`Finding ${c.n}: ${c.f.title} (${categoryLabel[c.f.category]}, ${c.f.severity} severity)`}
          onClick={(e) => {
            e.preventDefault();
            onJump(c.n);
          }}
          onFocus={() => onActivate(c.f.id)}
          onBlur={() => onActivate(null)}
          onMouseEnter={() => onActivate(c.f.id)}
          onMouseLeave={() => onActivate(null)}
          className={clsx(
            "relative -top-[0.55em] ml-px rounded-[2px] px-[1px] font-sans text-[11px] font-semibold select-none hover:underline",
            supColor[c.f.severity],
          )}
        >
          {c.n}
        </a>,
      );
    }
  }

  return (
    <div
      ref={ref}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
      className="font-display text-[21px] leading-[1.75] whitespace-pre-wrap"
    >
      {nodes}
    </div>
  );
}

/** Legend explaining underline styles so the marks never rely on colour alone. */
export function MarkLegend({ categories }: { categories: Finding["category"][] }) {
  const uniq = [...new Set(categories)];
  if (!uniq.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Underline key">
      {uniq.map((c) => (
        <li key={c} className="inline-flex items-center gap-1.5">
          <span className={clsx("proof-mark px-1 text-ink", categoryMark[c])} data-sev="low" style={{ cursor: "default", background: "transparent" }}>
            abc
          </span>
          {categoryLabel[c]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2 bg-proof" aria-hidden /> high
        <span className="ml-1 inline-block size-2 bg-ochre" aria-hidden /> medium
        <span className="ml-1 inline-block size-2 bg-steel" aria-hidden /> low
      </li>
    </ul>
  );
}
