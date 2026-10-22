"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
  href?: string; // link tabs (URL-driven)
  count?: number;
}

/**
 * Underlined tab row. Link tabs when items carry href (keeps state in the URL),
 * otherwise an ARIA tablist with arrow-key navigation driven by onChange.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const isLinks = items.every((i) => i.href);

  function onKey(e: KeyboardEvent, idx: number) {
    if (isLinks) return;
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    onChange?.(items[next].id);
    refs.current[next]?.focus();
  }

  const itemClass = (active: boolean) =>
    clsx(
      "relative inline-flex items-center gap-1.5 border-b-2 -mb-px font-medium transition-colors",
      size === "sm" ? "h-8 px-2 text-[13px]" : "h-10 px-3 text-sm",
      active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink hover:border-rule-strong",
    );

  const countEl = (n?: number) =>
    n === undefined ? null : <span className="font-mono text-[11px] text-muted tabular-nums">{n}</span>;

  if (isLinks) {
    return (
      <nav aria-label={label} className={clsx("flex flex-wrap border-b border-rule", className)}>
        {items.map((it) => (
          <Link
            key={it.id}
            href={it.href!}
            aria-current={it.id === value ? "page" : undefined}
            className={itemClass(it.id === value)}
            scroll={false}
          >
            {it.label}
            {countEl(it.count)}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className={clsx("flex flex-wrap border-b border-rule", className)}>
      {items.map((it, i) => (
        <button
          key={it.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          type="button"
          aria-selected={it.id === value}
          tabIndex={it.id === value ? 0 : -1}
          onClick={() => onChange?.(it.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={itemClass(it.id === value)}
        >
          {it.label}
          {countEl(it.count)}
        </button>
      ))}
    </div>
  );
}
