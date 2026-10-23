"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { switchRoleAction, signOutAction } from "@/app/actions";
import type { Role } from "@/lib/types";
import { ROLES, roleLabel } from "@/components/format";
import { TourButton } from "./Tour";

const NAV = [
  { href: "/app", label: "Inbox", exact: true },
  { href: "/app/new", label: "New draft" },
  { href: "/app/compare", label: "Compare" },
  { href: "/app/brand", label: "Brand Space" },
  { href: "/app/recall", label: "Recall queue" },
  { href: "/app/insights", label: "Insights" },
  { href: "/app/audit", label: "Audit log" },
];

const PEOPLE: Record<Role, string> = {
  owner: "Priya Owner",
  creator: "Arjun Creator",
  reviewer: "Meera Legal",
  agency: "Bloom Agency",
};

export function TopBar({ user, brandName }: { user: { name: string; role: Role }; brandName: string }) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) menuRef.current.open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded focus:bg-ink focus:px-3 focus:py-1.5 focus:text-sheet"
      >
        Skip to content
      </a>
      <div className="flex h-14 items-center gap-6 px-6 lg:px-8">
        <Link href="/app" className="flex items-baseline gap-2">
          <span className="font-display text-[21px] font-medium tracking-[-0.01em]">Readback</span>
          <span className="hidden text-[13px] text-muted sm:inline">{brandName}</span>
        </Link>
        <nav aria-label="Main" className="flex min-w-0 flex-1 items-stretch gap-1 self-stretch overflow-x-auto">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.href || pathname.startsWith("/app/s/") : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={`nav-${n.href.split("/")[2] ?? "inbox"}`}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "inline-flex items-center border-b-2 px-2.5 text-[14px] whitespace-nowrap transition-colors",
                  active ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <TourButton />
        <details ref={menuRef} className="relative" data-tour="role-switch">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-[5px] border border-rule-strong bg-sheet px-3 text-[13.5px] hover:border-ink [&::-webkit-details-marker]:hidden">
            <span className="hidden sm:inline">{user.name}</span>
            <span className="text-muted">{roleLabel[user.role]}</span>
            <ChevronDown size={14} aria-hidden className="text-muted" />
          </summary>
          <div className="absolute right-0 mt-1.5 w-[268px] rounded-md border border-rule-strong bg-sheet p-1.5">
            <p className="px-2 pt-1 pb-2 text-[12px] text-muted">Switch demo role. You stay on this page.</p>
            <form action={switchRoleAction}>
              <input type="hidden" name="back" value={pathname} />
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="submit"
                  name="role"
                  value={r}
                  disabled={r === user.role}
                  className="flex w-full items-baseline justify-between rounded-[4px] px-2 py-1.5 text-left text-[13.5px] hover:bg-paper disabled:cursor-default disabled:bg-paper"
                >
                  <span>{roleLabel[r]}</span>
                  <span className="text-[12px] text-muted">{r === user.role ? "current" : PEOPLE[r]}</span>
                </button>
              ))}
            </form>
            <form action={signOutAction} className="mt-1 border-t border-rule pt-1">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13.5px] text-muted hover:bg-paper hover:text-ink"
              >
                <LogOut size={14} aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
