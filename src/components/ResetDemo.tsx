"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { resetDemoAction } from "@/app/app/brand/actions";

/** Owner-only: put the shared demo back to its starting state (the seeded drafts and brand content). */
export function ResetDemo() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1.5">
      {!confirming ? (
        <Button size="sm" variant="ghost" onClick={() => (setConfirming(true), setMsg(null))}>
          <RotateCcw size={13} aria-hidden /> Reset demo drafts
        </Button>
      ) : (
        <div className="flex max-w-[360px] flex-col items-end gap-2 rounded-md border border-rule-strong bg-sheet p-3 text-right">
          <p className="text-[12.5px] text-muted">
            Puts the seeded drafts (#137 to #147), facts, terms and demo store pages back to their starting state. Drafts people
            created are kept, and the audit log keeps its history. This also happens every morning.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>Cancel</Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await resetDemoAction();
                  setConfirming(false);
                  setMsg(r.ok ? { ok: true, text: "The demo is back to its starting state." } : { ok: false, text: r.error });
                  router.refresh();
                })
              }
            >
              {pending ? "Resetting, about 20 seconds" : "Reset now"}
            </Button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-[12.5px] text-moss" : "text-[12.5px] text-proof"}>{msg.text}</p>}
    </div>
  );
}
