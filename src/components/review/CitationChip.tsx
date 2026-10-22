import type { Finding } from "@/lib/types";

const kindLabel = { clause: "Clause", fact: "Fact", wcag: "WCAG" } as const;

/** Mono code chip; expands in place to show the cited text. */
export function CitationChip({
  citation,
  version,
}: {
  citation: NonNullable<Finding["citation"]>;
  version?: number | null;
}) {
  return (
    <details className="group text-[13px]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[4px] border border-rule-strong bg-paper px-1.5 py-px hover:border-ink [&::-webkit-details-marker]:hidden">
        <span className="text-[11.5px] text-muted">{kindLabel[citation.kind]}</span>
        <span className="font-mono text-[12px] font-medium">
          {citation.kind === "wcag" ? `SC ${citation.code.replace(/^SC\s*/i, "")}` : citation.code}
        </span>
        {version ? <span className="font-mono text-[11px] text-muted">v{version}</span> : null}
        <span className="sr-only">, show cited text</span>
      </summary>
      <blockquote className="mt-1.5 border-l-2 border-rule-strong pl-3 font-display text-[14.5px] leading-snug text-ink/90">
        {citation.text}
      </blockquote>
    </details>
  );
}
