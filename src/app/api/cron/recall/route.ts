import { dailySweep } from "@/lib/recall/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily Live Fact Recall sweep, called by Vercel Cron (vercel.json). When CRON_SECRET is set, only Vercel's scheduler
 * (which sends it as a bearer token) may run it. Without it the sweep is still safe to trigger: every step is
 * idempotent (expired facts stay expired, alerts are sent once, a page is re-checked at most every 20 hours).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // the public demo also starts each day from its seeded state (set DEMO_DAILY_RESET=0 to keep visitors' changes)
    const reset = process.env.DEMO_DAILY_RESET !== "0" && !!process.env.DEMO_PASSWORD;
    return Response.json({ ok: true, ...(await dailySweep({ resetOrigin: reset ? new URL(req.url).origin : undefined })) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "sweep failed" }, { status: 500 });
  }
}
