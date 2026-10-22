"use client";

import { useActionState } from "react";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { verifyChainAction, type VerifyState } from "@/app/app/audit/actions";
import { Button } from "@/components/ui/Button";
import { fmtDateTime } from "@/components/format";

export function VerifyChain({ count }: { count: number }) {
  const [state, action, pending] = useActionState<VerifyState>(verifyChainAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
        {pending ? "Recomputing hashes" : "Verify chain"}
      </Button>
      <p role="status" aria-live="polite" className="max-w-[46ch] text-right text-[12.5px]">
        {state.status === "ok" && (
          <span className="text-moss">
            Intact. Every hash matches SHA-256 of the previous hash and its row ({count} shown here), checked{" "}
            {fmtDateTime(state.at)}.
          </span>
        )}
        {state.status === "broken" && (
          <span className="inline-flex items-start gap-1 text-proof">
            <TriangleAlert size={14} aria-hidden className="mt-px shrink-0" />
            Chain broken{state.brokenAt !== null ? ` at entry ${state.brokenAt}` : ""}. A row was altered or removed outside the app.
          </span>
        )}
        {state.status === "error" && <span className="text-proof">{state.message}</span>}
        {state.status === "idle" && <span className="text-muted">Recomputes every hash on the server.</span>}
      </p>
    </form>
  );
}
