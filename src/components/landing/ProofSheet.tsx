"use client";

// Landing hero: draft #142 with its proof marks. Each mark is a button; the note beside it says what readers
// believed and which rule or fact it was checked against. It's the product in miniature, and the page's one bold element.
import { useState } from "react";
import { clsx } from "clsx";
import { BeliefMeter } from "@/components/review/BeliefMeter";

type Note = { engine: "AI" | "RULE"; sev: "high" | "medium"; kind: string; meter: number | null; head: string; body: string; cite: string };

const NOTES: Record<number, Note> = {
  1: {
    engine: "AI", sev: "high", kind: "mark-wavy", meter: 4,
    head: "4 of 6 readers think a dermatologist recommends this serum",
    body: "The Fact Ledger only supports “dermatologist-tested”. Suggested fix: “Dermatologist-tested”.",
    cite: "F-03",
  },
  2: {
    engine: "AI", sev: "high", kind: "mark-wavy", meter: 5,
    head: "5 of 6 readers think results are guaranteed within a week",
    body: "The clinical study measured radiance at week 4. Suggested fix: “71% saw more radiant skin in 4 weeks*”.",
    cite: "F-07",
  },
  3: {
    engine: "RULE", sev: "medium", kind: "mark-double", meter: null,
    head: "“zero chemicals” is a banned term",
    body: "Velura’s guidelines never describe products as chemical-free. Suggested fix: “92% naturally derived ingredients”.",
    cite: "G-01",
  },
};

function Mark({ n, active, onSelect, children }: { n: number; active: boolean; onSelect: (n: number) => void; children: React.ReactNode }) {
  const note = NOTES[n];
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      onMouseEnter={() => onSelect(n)}
      aria-pressed={active}
      aria-describedby={active ? "proof-note" : undefined}
      className={clsx("proof-mark rounded-[2px] text-left", note.kind, active && "bg-proof-tint")}
      data-sev={note.sev}
    >
      {children}
      <sup aria-hidden className="ml-0.5 font-sans text-[11px] font-semibold" style={{ color: note.sev === "high" ? "var(--color-proof)" : "var(--color-ochre)" }}>
        {n}
      </sup>
    </button>
  );
}

export function ProofSheet() {
  const [sel, setSel] = useState(2);
  const note = NOTES[sel];
  return (
    <figure aria-label="Example: Velura draft #142 marked up by Readback" className="rounded-md border border-rule-strong bg-sheet">
      <figcaption className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-3 text-[13px] text-muted">
        <span>Instagram caption from an agency, before review</span>
        <span className="hidden sm:inline">Select a marked phrase</span>
      </figcaption>
      <p className="px-5 pt-5 pb-4 font-display text-[22px] leading-[1.65] sm:text-[24px]">
        <Mark n={1} active={sel === 1} onSelect={setSel}>Dermatologist-loved</Mark> Vitamin C serum.{" "}
        <Mark n={2} active={sel === 2} onSelect={setSel}>Visible glow in 7 days</Mark>. 100% natural,{" "}
        <Mark n={3} active={sel === 3} onSelect={setSel}>zero chemicals</Mark>. Shop now
      </p>
      <div id="proof-note" aria-live="polite" className="mx-5 mb-5 border-t border-rule pt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <span className="font-mono">[{note.engine}]</span>
          {note.meter !== null && <BeliefMeter k={note.meter} of={6} compact />}
          <span className="ml-auto rounded-[3px] border border-rule-strong px-1.5 font-mono text-[11.5px] text-ink">{note.cite}</span>
        </div>
        <p className="text-[15px] font-medium leading-snug">{note.head}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{note.body}</p>
      </div>
    </figure>
  );
}
