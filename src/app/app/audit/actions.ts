"use server";

import { verifyAuditChain } from "@/lib/db/queries";

export type VerifyState = { status: "idle" } | { status: "ok"; at: string } | { status: "broken"; brokenAt: number | null; at: string } | { status: "error"; message: string };

export async function verifyChainAction(): Promise<VerifyState> {
  try {
    const r = await verifyAuditChain();
    const at = new Date().toISOString();
    return r.ok ? { status: "ok", at } : { status: "broken", brokenAt: r.brokenAt, at };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Verification failed." };
  }
}
