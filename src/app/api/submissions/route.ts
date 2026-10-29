import { NextResponse } from "next/server";
import { createSubmission, getSessionUser } from "@/lib/db/queries";
import type { Channel, Lang } from "@/lib/types";
import { isLang } from "@/lib/lang";

export const runtime = "nodejs";

const CHANNELS: Channel[] = ["instagram", "website", "amazon", "nykaa", "whatsapp", "email", "other"];
const MAX_IMAGE = 8 * 1024 * 1024;

function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/**
 * Multipart draft submission. A route handler rather than a server action so
 * images above the 1 MB server-action body limit still go through.
 */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The form could not be read." }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const intent = String(form.get("intent") ?? "").trim();
  const channel = String(form.get("channel") ?? "") as Channel;
  const lang = String(form.get("lang") ?? "") as Lang;
  const lockedPhrases = String(form.get("locked") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const altRaw = String(form.get("alt") ?? "").trim();
  const masterId = String(form.get("master") ?? "").trim() || null;

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Give the draft a title your reviewer will recognise.";
  if (!body) errors.body = "Paste the copy you want checked.";
  if (!intent) errors.intent = "Say in one line what a reader should take away.";
  if (title.length > 160) errors.title = "Keep the title under 160 characters.";
  if (body.length > 5000) errors.body = "Keep the copy under 5,000 characters; split longer pieces into separate drafts.";
  if (intent.length > 300) errors.intent = "Keep the intended takeaway to one line (under 300 characters).";
  if (!CHANNELS.includes(channel)) errors.channel = "Pick a channel.";
  if (!isLang(lang)) errors.lang = "Pick a language.";
  if (masterId && lang === "en") errors.lang = "A translation needs a language other than English.";
  if (masterId && !/^[0-9a-f-]{36}$/i.test(masterId)) errors.form = "The master draft link is not valid.";
  for (const p of lockedPhrases) {
    if (!body.toLowerCase().includes(p.toLowerCase())) errors.locked = `Locked phrase “${p}” does not appear in the copy.`;
  }

  let image: { data: Buffer; mime: string; alt: string | null } | undefined;
  const file = form.get("image");
  if (file && typeof file !== "string" && file.size > 0) {
    if (!file.type.startsWith("image/")) errors.image = "Upload a PNG, JPEG or WebP image.";
    else if (file.size > MAX_IMAGE) errors.image = "Images must be 8 MB or smaller.";
    else {
      const data = Buffer.from(await file.arrayBuffer());
      const mime = sniffImage(data); // trust the bytes, not the browser-supplied type
      if (!mime) errors.image = "That file is not a PNG, JPEG, WebP or GIF image.";
      else image = { data, mime, alt: altRaw || null };
    }
  }

  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 422 });

  try {
    const ids = await createSubmission({ title, channel, lang, intent, body, lockedPhrases, image, masterId });
    return NextResponse.json(ids);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save the draft.";
    if (/master_id|submissions_lang_check/.test(msg))
      return NextResponse.json({ error: "Translations need the Round 3 database update (supabase/migrations/0003_round3.sql). Ask the workspace admin to run it." }, { status: 503 });
    return NextResponse.json({ error: msg }, { status: /not found|translation|English master|language/i.test(msg) ? 422 : 500 });
  }
}
