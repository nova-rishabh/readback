// Seeds Supabase for the Velura demo. Idempotent: re-running upserts by email / code / number.
// Usage: pnpm seed   (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD in .env.local)
// SEED_DRY=1 pnpm seed builds the seed data without touching the database.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(resolve(process.cwd(), f)); } catch { /* optional */ }
}

async function main() {
  const { buildSubmissions, seedDemo } = await import("../src/lib/demo/seed");
  if (process.env.SEED_DRY === "1") {
    const subs = buildSubmissions();
    console.log(`dry run ok: ${subs.length} submissions, ${subs.reduce((n, s) => n + s.versions.reduce((m, v) => m + v.findings.length, 0), 0)} findings`);
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.DEMO_PASSWORD;
  if (!url || !key || !password) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or DEMO_PASSWORD (see supabase/README.md).");
    process.exit(1);
  }
  const img = resolve(process.cwd(), "public/demo/velura-142.png");
  await seedDemo(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), {
    password, image: existsSync(img) ? readFileSync(img) : null, log: (l) => console.log(l),
  });
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
