import { getBrand, getSessionUser } from "@/lib/db/queries";
import { compareVersions } from "@/lib/ai/drift";
import { QuotaError } from "@/lib/ai/provider";
import type { Lang } from "@/lib/types";
import { isLang } from "@/lib/lang";
import { keyFrom } from "@/lib/ai/key-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { master, variant, variantLang } -> DriftResult. Text is masked by the Privacy Gate inside callObject. */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { master?: string; variant?: string; variantLang?: Lang } | null;
  const master = body?.master?.trim();
  const variant = body?.variant?.trim();
  if (!master || !variant) return Response.json({ error: "Paste both the English master and the translated version." }, { status: 400 });
  if (master.length > 4000 || variant.length > 4000) return Response.json({ error: "Each version can be at most 4,000 characters." }, { status: 400 });
  try {
    const brand = await getBrand();
    return Response.json(await compareVersions({ master, variant, variantLang: isLang(body?.variantLang) && body.variantLang !== "en" ? body.variantLang : "hi", brand, apiKey: keyFrom(req) }));
  } catch (e) {
    const msg =
      e instanceof QuotaError
        ? e.reason === "quota"
          ? `Gemini free-tier limit reached. Try again in ${e.retryAfterSeconds}s.`
          : "Gemini is overloaded right now. Try again in a minute."
        : "The comparison failed. Try again.";
    return Response.json({ error: msg }, { status: 503 });
  }
}
