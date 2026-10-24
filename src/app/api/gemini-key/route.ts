import { getSessionUser } from "@/lib/db/queries";
import { keyFrom } from "@/lib/ai/key-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST with the key in the x-gemini-key header: asks Google whether the key works. Nothing is stored. */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const key = keyFrom(req);
  if (!key) return Response.json({ ok: false, error: "That doesn't look like a Gemini API key. It starts with “AIza”." }, { status: 400 });
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=50", {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const msg = r.status === 400 || r.status === 403 ? "Google rejected this key. Check it in Google AI Studio." : `Google answered ${r.status}. Try again.`;
      return Response.json({ ok: false, error: msg }, { status: 400 });
    }
    const j = (await r.json()) as { models?: { name: string }[] };
    const flash = (j.models ?? []).some((m) => /flash/.test(m.name));
    return Response.json({ ok: true, flash });
  } catch {
    return Response.json({ ok: false, error: "Couldn't reach Google to check the key. Try again." }, { status: 502 });
  }
}
