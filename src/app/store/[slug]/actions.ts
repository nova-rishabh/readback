"use server";

import { revalidatePath } from "next/cache";
import { getActor, writeAudit } from "@/lib/db/queries";
import { createClient } from "@/lib/db/server";

export async function saveLivePageAction(slug: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getActor();
  if (!actor || actor.role === "agency") return { ok: false, error: "Sign in as the brand owner, creator or reviewer to edit the demo store." };
  const text = body.trim();
  if (!text) return { ok: false, error: "The page needs some text." };
  if (text.length > 5000) return { ok: false, error: "Keep the page under 5,000 characters." };
  const sb = await createClient();
  const { data, error } = await sb.from("live_pages").update({ body: text }).eq("slug", slug).select("slug").maybeSingle();
  if (error || !data) {
    return { ok: false, error: error && /live_pages/.test(error.message) ? "The demo store needs the Round 3 database update (0003)." : "The page was not saved." };
  }
  await writeAudit(actor, { action: "live_page_edited", detail: { slug, chars: text.length } });
  revalidatePath(`/store/${slug}`);
  return { ok: true };
}
