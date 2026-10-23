"use server";

import { revalidatePath } from "next/cache";
import {
  addComment,
  addVersion,
  getSessionUser,
  recordPublishedUrl,
  setStatus,
  updateFinding,
} from "@/lib/db/queries";
import type { Finding, Span, SubmissionStatus } from "@/lib/types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(e: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error && e.message ? e.message : fallback };
}

export async function updateFindingAction(
  submissionId: string,
  versionId: string,
  findingId: string,
  patch: Partial<Pick<Finding, "status" | "dispute_note" | "applied_replacement">>,
): Promise<ActionResult> {
  try {
    await updateFinding(versionId, findingId, patch);
    revalidatePath(`/app/s/${submissionId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "The finding could not be updated.");
  }
}

export async function addCommentAction(
  submissionId: string,
  versionN: number,
  body: string,
  anchor: Span | null,
): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Write a comment first." };
  if (text.length > 4000) return { ok: false, error: "Comments are limited to 4,000 characters." };
  try {
    await addComment(submissionId, versionN, text, anchor);
    revalidatePath(`/app/s/${submissionId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "The comment was not saved.");
  }
}

const REVIEW_ONLY: SubmissionStatus[] = ["approved", "changes_requested"];

export async function setStatusAction(
  submissionId: string,
  status: SubmissionStatus,
  note?: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session ended. Sign in again." };
  if (REVIEW_ONLY.includes(status) && user.role !== "reviewer" && user.role !== "owner") {
    return { ok: false, error: "Only a reviewer or the brand owner can approve or request changes." };
  }
  if (status === "changes_requested" && !note?.trim()) {
    return { ok: false, error: "Say what needs to change so the author can act on it." };
  }
  try {
    await setStatus(submissionId, status, note?.trim() || undefined);
    revalidatePath(`/app/s/${submissionId}`);
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    return fail(e, "The status was not changed.");
  }
}

export async function recordUrlAction(submissionId: string, url: string): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
  } catch {
    return { ok: false, error: "Enter the full link to the live post, starting with https://" };
  }
  try {
    await recordPublishedUrl(submissionId, parsed.toString());
    revalidatePath(`/app/s/${submissionId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "The URL was not recorded.");
  }
}

export async function saveVersionAction(
  submissionId: string,
  input: { body: string; image_path: string | null; image_alt: string | null },
): Promise<ActionResult<{ versionId: string }>> {
  if (!input.body.trim()) return { ok: false, error: "The new version has no copy." };
  try {
    const versionId = await addVersion(submissionId, {
      body: input.body,
      image_path: input.image_path,
      image_alt: input.image_alt,
    });
    revalidatePath(`/app/s/${submissionId}`);
    return { ok: true, data: { versionId } };
  } catch (e) {
    return fail(e, "The new version was not saved.");
  }
}
