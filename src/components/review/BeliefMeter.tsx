import { clsx } from "clsx";

/** k of n readers, drawn as n small squares. Always labelled for assistive tech. */
export function BeliefMeter({
  k,
  of,
  compact,
  showText,
  tone = "ink",
}: {
  k: number;
  of: number;
  compact?: boolean;
  showText?: boolean;
  tone?: "ink" | "proof" | "ochre" | "steel" | "moss";
}) {
  const n = Math.max(1, of);
  const filled = Math.max(0, Math.min(n, k));
  const label = `${filled} of ${n} readers formed this belief`;
  const fill = {
    ink: "bg-ink border-ink",
    proof: "bg-proof border-proof",
    ochre: "bg-ochre border-ochre",
    steel: "bg-steel border-steel",
    moss: "bg-moss border-moss",
  }[tone];
  return (
    <span className="inline-flex items-center gap-2">
      <span role="img" aria-label={label} title={label} className="inline-flex gap-[3px]">
        {Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            className={clsx(
              "block rounded-[1.5px] border",
              compact ? "size-[7px]" : "size-[9px]",
              i < filled ? fill : "border-rule-strong bg-transparent",
            )}
          />
        ))}
      </span>
      {showText && (
        <span aria-hidden className="text-[12.5px] tabular-nums text-muted">
          {filled} of {n} readers
        </span>
      )}
    </span>
  );
}
