import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/db/queries";
import { extractText, firstDocxImage, tidy } from "@/lib/docs/extract";

export const runtime = "nodejs";

const MAX = 10 * 1024 * 1024;
const MAX_COPY = 5000;

/** POST multipart { file } -> { text, truncated, image?: { base64, mime } } for the New draft form. */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || file.size === 0) return NextResponse.json({ error: "Choose a PDF, DOCX or TXT file." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "Documents must be 10 MB or smaller." }, { status: 413 });
  try {
    const text = tidy(await extractText(file));
    if (!text) return NextResponse.json({ error: "No text was found in that file. A scanned PDF has no text layer; paste the copy instead." }, { status: 422 });
    const image = await firstDocxImage(file).catch(() => null);
    return NextResponse.json({
      text: text.slice(0, MAX_COPY),
      truncated: text.length > MAX_COPY,
      image: image && image.data.length <= 8 * 1024 * 1024 ? { base64: image.data.toString("base64"), mime: image.mime } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The file could not be read." }, { status: 422 });
  }
}
