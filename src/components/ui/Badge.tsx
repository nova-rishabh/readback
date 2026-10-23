import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { Severity, SubmissionStatus, Verdict } from "@/lib/types";

export type Tone = "neutral" | "proof" | "ochre" | "steel" | "moss" | "ink";

const tones: Record<Tone, string> = {
  neutral: "border-rule-strong text-muted bg-sheet",
  proof: "border-proof/40 text-proof bg-proof-tint",
  ochre: "border-ochre/40 text-ochre bg-ochre-tint",
  steel: "border-steel/40 text-steel bg-steel-tint",
  moss: "border-moss/40 text-moss bg-moss-tint",
  ink: "border-ink text-sheet bg-ink",
};

export function Badge({
  tone = "neutral",
  mono,
  className,
  children,
  title,
}: {
  tone?: Tone;
  mono?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[12px] leading-[18px] whitespace-nowrap",
        mono ? "font-mono text-[11.5px]" : "font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const severityTone: Record<Severity, Tone> = { high: "proof", medium: "ochre", low: "steel" };
export const severityLabel: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severityTone[severity]}>{severityLabel[severity]}</Badge>;
}

export const statusLabel: Record<SubmissionStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  recalled: "Recalled",
};

const statusTone: Record<SubmissionStatus, Tone> = {
  draft: "neutral",
  in_review: "steel",
  changes_requested: "ochre",
  approved: "moss",
  published: "ink",
  recalled: "proof",
};

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <Badge tone={statusTone[status]} className="rounded-full px-2">
      {statusLabel[status]}
    </Badge>
  );
}

export function VerdictBadge({ verdict, factCode, split }: { verdict: Verdict; factCode: string | null; split?: string }) {
  switch (verdict) {
    case "supported":
      return <Badge tone="moss">Supported{factCode ? ` by ${factCode}` : ""}</Badge>;
    case "contradicted":
      return <Badge tone="proof">Contradicted{factCode ? ` by ${factCode}` : ""}</Badge>;
    case "unsupported":
      return (
        <Badge tone="ochre" title="No approved fact backs this belief. That is not the same as false.">
          Unsupported{factCode ? ` (nearest ${factCode})` : ": no approved fact covers this"}
        </Badge>
      );
    case "ambiguous":
      return <Badge tone="steel">Ambiguous{split ? `: readers split ${split}` : ""}</Badge>;
  }
}
