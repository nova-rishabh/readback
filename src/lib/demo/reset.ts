// Resetting the shared demo: the seeded drafts and brand content go back to their starting state, so every visitor
// (and every judge) can walk the same journeys. Drafts people created themselves are kept.
import { createAdmin } from "../db/server";
import { writeAudit } from "../db/queries";
import { seedDemo } from "./seed";

type Actor = { id: string | null; name: string; role: string };

export async function resetDemo(origin: string, actor: Actor): Promise<{ submissions: number }> {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("DEMO_PASSWORD is not set on the server");
  const admin = createAdmin();
  const { data: last } = await admin.from("audit_log").select("created_at").eq("action", "demo_reset").order("id", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.created_at) < 120_000) throw new Error("The demo was reset less than two minutes ago.");
  let image: Buffer | null = null;
  try {
    const res = await fetch(`${origin}/demo/velura-142.png`, { cache: "no-store" });
    if (res.ok) image = Buffer.from(await res.arrayBuffer());
  } catch {
    image = null; // the seeded hero post then has no image; everything else still resets
  }
  const out = await seedDemo(admin, { password, image, refreshUsers: false }); // keep everyone signed in
  await writeAudit(actor as never, { action: "demo_reset_requested", detail: { submissions: out.submissions } });
  return out;
}
