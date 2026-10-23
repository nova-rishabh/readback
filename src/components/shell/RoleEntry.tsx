"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { enterAsRoleAction, emailSignInAction, type AuthState } from "@/app/actions";
import type { Role } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

const ENTRIES: { role: Role; title: string; person: string; does: string }[] = [
  {
    role: "creator",
    title: "Creator",
    person: "Arjun Creator, Velura in-house",
    does: "Submits drafts, accepts fixes, saves new versions.",
  },
  {
    role: "reviewer",
    title: "Reviewer",
    person: "Meera Legal, compliance",
    does: "Approves or requests changes. Every decision is hash-logged.",
  },
  {
    role: "owner",
    title: "Brand owner",
    person: "Priya Owner, founder",
    does: "Edits clauses, the Fact Ledger, banned terms and personas.",
  },
  {
    role: "agency",
    title: "Agency",
    person: "Bloom Agency, external",
    does: "Sees only its own submissions. Brand Space is read-only.",
  },
];

const initial: AuthState = { error: null };

export function RoleEntries() {
  const [state, action, pending] = useActionState(enterAsRoleAction, initial);
  return (
    <form action={action}>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
        {ENTRIES.map((e) => (
          <button
            key={e.role}
            type="submit"
            name="role"
            value={e.role}
            disabled={pending}
            className="group flex min-h-[148px] flex-col items-start gap-2 bg-sheet p-5 text-left transition-colors hover:bg-paper focus-visible:z-10 disabled:opacity-60"
          >
            <span className="font-display text-[26px] leading-none tracking-[-0.01em]">Enter as {e.title.toLowerCase()}</span>
            <span className="text-[13px] text-muted">{e.person}</span>
            <span className="mt-auto text-[14px] leading-snug">{e.does}</span>
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-[13px]">
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <LoaderCircle size={14} className="animate-spin" aria-hidden /> Signing in with the seeded demo account
          </span>
        )}
        {state.error && !pending && <span className="text-proof">{state.error}</span>}
      </p>
    </form>
  );
}

export function EmailSignIn() {
  const [state, action, pending] = useActionState(emailSignInAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
      <Field label="Password">
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </Button>
      {state.error && <p className="text-[13px] text-proof sm:col-span-3">{state.error}</p>}
    </form>
  );
}

/** A single "enter as" button for the landing hero; same seeded sign-in as the role grid. */
export function EnterAsButton({ role, children }: { role: Role; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(enterAsRoleAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="role" value={role} />
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
        {pending ? "Opening the workspace" : children}
      </Button>
      {state.error && !pending && <p className="max-w-[40ch] text-[13px] text-proof">{state.error}</p>}
    </form>
  );
}
