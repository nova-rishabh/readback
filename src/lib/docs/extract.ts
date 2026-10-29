// Text (and, for DOCX, the first image) from an uploaded document. Shared by guideline import and draft import.

export const DOC_TYPES = ".pdf,.docx,.txt,.md";

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file is not a valid PDF.");
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (name.endsWith(".docx")) {
    if (buf.subarray(0, 2).toString("latin1") !== "PK") throw new Error("That file is not a valid DOCX.");
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return buf.toString("utf8");
  throw new Error("Upload a PDF, DOCX or TXT file.");
}

/** The first embedded image of a DOCX, if any (PNG, JPEG or WebP only). */
export async function firstDocxImage(file: File): Promise<{ data: Buffer; mime: string } | null> {
  if (!file.name.toLowerCase().endsWith(".docx")) return null;
  const mammoth = await import("mammoth");
  const buf = Buffer.from(await file.arrayBuffer());
  let found: { data: Buffer; mime: string } | null = null;
  await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (img) => {
        if (!found && /^image\/(png|jpeg|webp)$/.test(img.contentType)) {
          found = { data: Buffer.from(await img.readAsBase64String(), "base64"), mime: img.contentType };
        }
        return { src: "" };
      }),
    },
  );
  return found;
}

/** Collapse extracted text into draft copy: single blank lines between paragraphs, no trailing spaces. */
export function tidy(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
