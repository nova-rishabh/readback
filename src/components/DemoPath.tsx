"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

export interface DemoStep { href: string; label: string; detail: string }

/**
 * First-visit shortcuts to the journeys worth seeing, so someone new to Readback can explore without a walkthrough.
 * Dismissal is remembered per browser; storage failures just keep the card visible.
 */
export function DemoPath({ steps }: { steps: DemoStep[] }) {
  const KEY = "readback-demo-path-hidden";
  const [hidden, setHidden] = useState(true); // avoid a flash before storage is read
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden || !steps.length) return null;
  return (
    <section aria-labelledby="demo-path-h" className="relative mb-6 rounded-md border border-rule-strong bg-sheet px-5 py-4">
      <button
        type="button"
        aria-label="Hide these suggestions"
        className="absolute right-2 top-2 rounded p-1.5 text-muted hover:bg-paper hover:text-ink"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* private mode: hidden for this visit only */
          }
        }}
      >
        <X size={15} aria-hidden />
      </button>
      <h2 id="demo-path-h" className="font-display text-[19px]">New here? Try these</h2>
      <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.href} className="flex gap-2.5 text-[13.5px]">
            <span className="font-display text-[20px] leading-none text-proof" aria-hidden>{i + 1}</span>
            <span>
              <Link href={s.href} className="font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                {s.label}
              </Link>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
