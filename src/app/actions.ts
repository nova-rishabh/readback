"use server";

import { redirect } from "next/navigation";
import { signInAsRole } from "@/lib/db/queries";
import { createClient } from "@/lib/db/server";
import type { Role } from "@/lib/types";
import { ROLES, errMessage } from "@/components/format";

export type AuthState = { error: string | null };

export async function enterAsRoleAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const role = String(formData.get("role") ?? "") as Role;
  if (!ROLES.includes(role)) return { error: "Pick one of the four demo roles." };
  let res: { ok: boolean; error: string | null };
  try {
    res = await signInAsRole(role);
  } catch (e) {
    res = { ok: false, error: errMessage(e) };
  }
  if (!res.ok) {
    return { error: `Could not sign in as ${role}: ${res.error ?? "unknown error"}. Check DEMO_PASSWORD and that pnpm seed has run.` };
  }
  redirect("/app");
}

/** Used by the role switcher in the top bar; keeps the user on the same page when possible. */
export async function switchRoleAction(formData: FormData) {
  const role = String(formData.get("role") ?? "") as Role;
  const back = String(formData.get("back") ?? "/app");
  if (!ROLES.includes(role)) return;
  const res = await signInAsRole(role);
  if (!res.ok) redirect("/");
  redirect(back.startsWith("/app") ? back : "/app");
}

export async function emailSignInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter both email and password." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: "That email and password did not match a Readback user." };
  } catch (e) {
    return { error: errMessage(e) };
  }
  redirect("/app");
}

export async function signOutAction() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // fall through to landing either way
  }
  redirect("/");
}
