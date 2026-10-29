import type { Channel, FindingCategory, Lang, Role, SubmissionStatus } from "@/lib/types";
import { LANG_NAME } from "@/lib/lang";

export const ROLES: Role[] = ["owner", "creator", "reviewer", "agency"];

export const roleLabel: Record<Role, string> = {
  owner: "Brand owner",
  creator: "Creator",
  reviewer: "Reviewer",
  agency: "Agency",
};

export const channelLabel: Record<Channel, string> = {
  instagram: "Instagram",
  website: "Website",
  amazon: "Amazon listing",
  nykaa: "Nykaa listing",
  whatsapp: "WhatsApp",
  email: "Email",
  other: "Other",
};

export const langLabel: Record<Lang, string> = LANG_NAME;

export const STATUSES: SubmissionStatus[] = ["draft", "in_review", "changes_requested", "approved", "published", "recalled"];

export const categoryLabel: Record<FindingCategory, string> = {
  terminology: "Terminology",
  disclaimer: "Disclaimer",
  embargo: "Embargo",
  accessibility: "Accessibility",
  visual: "Visual",
  tone: "Tone",
  claim: "Claim",
  language_drift: "Language drift",
};

/** Underline style per category, so marks never rely on colour alone. */
export const categoryMark: Record<FindingCategory, string> = {
  claim: "mark-wavy",
  tone: "mark-wavy",
  terminology: "mark-double",
  disclaimer: "mark-dashed",
  language_drift: "mark-dashed",
  embargo: "mark-solid",
  accessibility: "mark-dotted",
  visual: "mark-dotted",
};

export function canReview(role: Role) {
  return role === "reviewer" || role === "owner";
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export function relDays(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / 86_400_000);
}

export function errMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Something went wrong.";
}
