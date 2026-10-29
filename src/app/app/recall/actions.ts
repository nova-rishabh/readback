"use server";

import { revalidatePath } from "next/cache";
import { getActor, getRecallState, setStatus } from "@/lib/db/queries";
import { closeRecall, runLiveCheck } from "@/lib/recall/queue";
import type { LiveCheck } from "@/lib/recall/live";

export type RecallResult = { ok: true; check?: LiveCheck } | { ok: false; error: string };

async function findItem(submissionId: string, factCode: string) {
  const state = await getRecallState();
  return state.open.find((i) => i.submission.id === submissionId && i.fact_code === factCode) ?? null;
}

function refresh(submissionId: string) {
  revalidatePath("/app/recall");
  revalidatePath(`/app/s/${submissionId}`);
  revalidatePath("/app");
}

export async function recallAction(submissionId: string, factCode: string) {
  await setStatus(submissionId, "recalled", `Recalled after ${factCode} changed.`);
  refresh(submissionId);
}

/** Fetch the live page now and record whether the stale claim is still on it. */
export async function checkLiveAction(submissionId: string, factCode: string): Promise<RecallResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Your session ended. Sign in again." };
  try {
    const item = await findItem(submissionId, factCode);
    if (!item) return { ok: false, error: "This recall is already closed. Refresh the page." };
    if (!item.url) return { ok: false, error: "No live URL is recorded for this post. Record it on the post first." };
    if (item.last_check && Date.now() - Date.parse(item.last_check.at) < 30_000) {
      return { ok: false, error: "This page was checked a few seconds ago. Wait half a minute before checking again." };
    }
    const check = await runLiveCheck(item, actor);
    refresh(submissionId);
    return { ok: true, check };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The live page could not be checked." };
  }
}

/** A reviewer closes a recall by hand, for example after confirming the post was edited somewhere we cannot fetch. */
export async function closeRecallAction(submissionId: string, factCode: string, note: string): Promise<RecallResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Your session ended. Sign in again." };
  if (actor.role !== "reviewer" && actor.role !== "owner") return { ok: false, error: "Only a reviewer or the brand owner can close a recall." };
  const text = note.trim();
  if (!text) return { ok: false, error: "Say how the post was fixed, for the audit log." };
  if (text.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
  try {
    const item = await findItem(submissionId, factCode);
    if (!item) return { ok: false, error: "This recall is already closed. Refresh the page." };
    await closeRecall(item, actor, text);
    refresh(submissionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The recall was not closed." };
  }
}
