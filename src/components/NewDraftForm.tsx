"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, ImageUp, LoaderCircle, X } from "lucide-react";
import type { Channel, Lang } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { channelLabel, langLabel } from "@/components/format";
import { LANG_TAG } from "@/lib/lang";

const EXAMPLE = {
  title: "Vitamin C serum launch, Instagram post",
  channel: "instagram" as Channel,
  lang: "en" as Lang,
  body: "Dermatologist-loved Vitamin C serum. Visible glow in 7 days. 100% natural, zero chemicals. Shop now",
  intent: "Regular use of Velura Vitamin C serum gives brighter-looking skin.",
  locked: "Vitamin C serum\nShop now",
  alt: "Model in a white lab coat holding a Velura serum bottle against green leaves, with the overlay text “Visible glow in 7 days”.",
};

type Errors = Partial<Record<"title" | "body" | "intent" | "channel" | "lang" | "locked" | "image" | "form", string>>;

const TRANSLATION_EXAMPLE: Partial<Record<Lang, string>> = {
  hi: "Velura विटामिन C सीरम। 4 हफ्तों में पक्का निखार। रोज़ इस्तेमाल के लिए सौम्य।",
  hinglish: "Velura Vitamin C serum. 4 hafte mein pakka glow. Daily use ke liye gentle.",
  ta: "Velura வைட்டமின் C சீரம். 4 வாரங்களில் நிச்சயம் பொலிவு. தினசரி பயன்பாட்டுக்கு மென்மையானது.",
  mr: "Velura व्हिटॅमिन C सीरम. 4 आठवड्यांत नक्की तेज. रोजच्या वापरासाठी सौम्य.",
};

export interface MasterInfo {
  id: string; number: number; title: string; body: string; version: number; channel: Channel; intent: string; lang: Lang;
}

export function NewDraftForm({ master = null }: { master?: MasterInfo | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(master ? `${master.title} (Hindi)` : "");
  const [channel, setChannel] = useState<Channel>(master?.channel ?? "instagram");
  const [lang, setLang] = useState<Lang>(master ? "hi" : "en");
  const [body, setBody] = useState("");
  const [intent, setIntent] = useState(master?.intent ?? "");
  const [locked, setLocked] = useState("");
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [loadingExample, setLoadingExample] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ name: string; note: string } | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(f: File | null) {
    setFile(f);
    setErrors((e) => ({ ...e, image: undefined }));
    if (!f && fileRef.current) fileRef.current.value = "";
  }

  async function loadExample() {
    setLoadingExample(true);
    setTitle(EXAMPLE.title);
    setChannel(EXAMPLE.channel);
    setLang(EXAMPLE.lang);
    setBody(EXAMPLE.body);
    setIntent(EXAMPLE.intent);
    setLocked(EXAMPLE.locked);
    setAlt(EXAMPLE.alt);
    setErrors({});
    try {
      const res = await fetch("/demo/velura-142.png");
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const f = new File([blob], "velura-142.png", { type: blob.type || "image/png" });
      setFile(f);
      if (fileRef.current && typeof DataTransfer !== "undefined") {
        const dt = new DataTransfer();
        dt.items.add(f);
        fileRef.current.files = dt.files;
      }
    } catch {
      setErrors({ image: "Couldn't load the demo image. Upload any PNG or JPEG instead." });
    } finally {
      setLoadingExample(false);
    }
  }

  /** Pull the copy (and a DOCX's first image) out of a document, so a draft written in Word or exported as PDF can be checked. */
  async function importDoc(f: File | null) {
    if (!f) return;
    setImporting(true);
    setErrors((e) => ({ ...e, body: undefined }));
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/drafts/extract", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { text?: string; truncated?: boolean; image?: { base64: string; mime: string } | null; error?: string };
      if (!res.ok || !j.text) throw new Error(j.error ?? "The document could not be read.");
      setBody(j.text);
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
      const notes = [j.truncated ? "copy cut to the first 5,000 characters" : null];
      if (j.image && !file) {
        const bytes = Uint8Array.from(atob(j.image.base64), (c) => c.charCodeAt(0));
        const ext = j.image.mime.split("/")[1].replace("jpeg", "jpg");
        pickFile(new File([bytes], `${f.name.replace(/\.[^.]+$/, "")}-image.${ext}`, { type: j.image.mime }));
        notes.push("its first image is attached; add alt text");
      }
      setImported({ name: f.name, note: notes.filter(Boolean).join("; ") });
    } catch (err) {
      setErrors((e) => ({ ...e, body: err instanceof Error ? err.message : "The document could not be read." }));
    } finally {
      setImporting(false);
      if (docRef.current) docRef.current.value = "";
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (!title.trim()) local.title = "Give the draft a title your reviewer will recognise.";
    if (!body.trim()) local.body = "Paste the copy you want checked.";
    if (!intent.trim()) local.intent = "Say in one line what a reader should take away.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSubmitting(true);
    setErrors({});
    const fd = new FormData();
    fd.set("title", title);
    fd.set("channel", channel);
    fd.set("lang", lang);
    fd.set("body", body);
    fd.set("intent", intent);
    fd.set("locked", locked);
    fd.set("alt", alt);
    if (file) fd.set("image", file);
    if (master) fd.set("master", master.id);
    if (imported) fd.set("source", imported.name);
    try {
      const res = await fetch("/api/submissions", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        submissionId?: string;
        errors?: Errors;
        error?: string;
      };
      if (!res.ok || !json.submissionId) {
        setErrors(json.errors ?? { form: json.error ?? `The server answered ${res.status}.` });
        setSubmitting(false);
        return;
      }
      router.push(`/app/s/${json.submissionId}?run=1`);
    } catch {
      setErrors({ form: "Could not reach the server. Check your connection and submit again." });
      setSubmitting(false);
    }
  }

  const lockedList = locked.split("\n").map((s) => s.trim()).filter(Boolean);
  const missingLocked = lockedList.filter((p) => body && !body.toLowerCase().includes(p.toLowerCase()));

  return (
    <form onSubmit={onSubmit} noValidate>
      {master ? (
        <div className="mb-8 flex flex-col gap-3 rounded-md border border-rule bg-sheet px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[14px] font-medium">
              Translating <span className="font-mono text-[12.5px]">#{master.number}</span> {master.title}{" "}
              <span className="font-normal text-muted">(English, v{master.version})</span>
            </p>
            {TRANSLATION_EXAMPLE[lang] && (
              <Button size="sm" onClick={() => setBody(TRANSLATION_EXAMPLE[lang]!)} disabled={submitting}>
                Fill in a sample {langLabel[lang]} translation
              </Button>
            )}
          </div>
          <p className="whitespace-pre-wrap rounded-[4px] border border-rule bg-paper px-3 py-2 font-display text-[16px] leading-relaxed">
            {master.body}
          </p>
          <p className="text-[12.5px] text-muted">
            The sample is a realistic agency translation that quietly makes a claim stronger, so you can see the comparison
            catch it.
          </p>
        </div>
      ) : (
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-md border border-rule bg-sheet px-5 py-4">
        <div>
          <p className="text-[14px] font-medium">Trying Readback for the first time?</p>
          <p className="text-[13.5px] text-muted">
            Load draft <span className="font-mono text-[12.5px]">#142</span>: a Vitamin C serum caption with a lab-coat image
            and low-contrast overlay text.
          </p>
        </div>
        <Button variant="primary" onClick={loadExample} disabled={loadingExample || submitting}>
          {loadingExample && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
          Fill in the demo draft
        </Button>
      </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-5">
          <Field label="Title (required)" error={errors.title} hint="Internal only. Reviewers see this in the inbox.">
            {(p) => <Input {...p} required aria-required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Channel" error={errors.channel}>
              {(p) => (
                <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                  {(Object.keys(channelLabel) as Channel[]).map((c) => (
                    <option key={c} value={c}>
                      {channelLabel[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Language" error={errors.lang}>
              {(p) => (
                <Select
                  {...p}
                  value={lang}
                  onChange={(e) => {
                    const next = e.target.value as Lang;
                    if (master && title === `${master.title} (${langLabel[lang]})`) setTitle(`${master.title} (${langLabel[next]})`);
                    setLang(next);
                  }}
                >
                  {(Object.keys(langLabel) as Lang[]).filter((l) => !master || l !== "en").map((l) => (
                    <option key={l} value={l}>
                      {langLabel[l]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="-mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted">
              {imported ? (
                <>
                  Imported from <span className="font-mono text-ink">{imported.name}</span>
                  {imported.note && `: ${imported.note}`}. Check the copy below before saving.
                </>
              ) : (
                "Written in Word or exported as PDF? Import it instead of pasting."
              )}
            </p>
            <Button size="sm" variant="ghost" onClick={() => docRef.current?.click()} disabled={importing || submitting}>
              {importing ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : <FileUp size={13} aria-hidden />}
              {importing ? "Reading the document" : "Import from DOCX, PDF or TXT"}
            </Button>
            <input
              ref={docRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void importDoc(e.target.files?.[0] ?? null)}
            />
          </div>
          <Field
            label="Copy (required)"
            error={errors.body}
            hint={`${body.length} characters. Paste it exactly as it will run, including hashtags and line breaks.`}
          >
            {(p) => (
              <Textarea
                {...p}
                required
                aria-required
                rows={7}
                lang={LANG_TAG[lang]}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-display text-[18px] leading-[1.6]"
              />
            )}
          </Field>
          <Field
            label="Intended takeaway (required)"
            error={errors.intent}
            hint="One line. Readers are asked whether they got this; fixes must keep it."
          >
            {(p) => <Input {...p} required aria-required value={intent} onChange={(e) => setIntent(e.target.value)} />}
          </Field>
          <Field
            label="Phrases fixes must keep"
            optional
            error={errors.locked ?? (missingLocked.length ? `Not in the copy: ${missingLocked.join(", ")}` : null)}
            hint="Optional. One per line, for example a product name or legal line."
          >
            {(p) => (
              <Textarea {...p} rows={3} value={locked} onChange={(e) => setLocked(e.target.value)} className="font-mono text-[13px]" />
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium" id="img-label">
              Image <span className="ml-1 font-normal text-muted">optional</span>
            </span>
            {preview ? (
              <div className="relative overflow-hidden rounded-md border border-rule bg-sheet">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={alt || "Preview of the uploaded image"} className="block max-h-[360px] w-full object-contain" />
                <div className="flex items-center justify-between border-t border-rule px-3 py-2 text-[12.5px]">
                  <span className="truncate font-mono text-muted">
                    {file?.name} ({Math.round((file?.size ?? 0) / 1024)} KB)
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => pickFile(null)}>
                    <X size={14} aria-hidden /> Remove
                  </Button>
                </div>
              </div>
            ) : (
              <label
                htmlFor="image-input"
                className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-control bg-sheet px-6 text-center text-[14px] text-muted hover:border-ink focus-within:border-ink"
              >
                <ImageUp size={18} aria-hidden />
                <span>
                  <span className="text-ink underline underline-offset-4">Choose an image</span> to check contrast, palette and
                  what readers see in it
                </span>
                <span className="text-[12.5px]">PNG, JPEG or WebP, up to 8 MB</span>
              </label>
            )}
            <input
              ref={fileRef}
              id="image-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-labelledby="img-label"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {errors.image && <p className="text-[12.5px] text-proof">{errors.image}</p>}
          </div>
          <Field label="Alt text" optional hint="Describe what the image shows and any text in it. Filenames do not count.">
            {(p) => <Textarea {...p} rows={3} value={alt} onChange={(e) => setAlt(e.target.value)} disabled={!file} />}
          </Field>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-rule pt-6">
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
          {submitting ? "Saving draft" : "Save and run check"}
        </Button>
        <p className="text-[13px] text-muted">
          {master
            ? "Next: the checks run, then readers compare this translation with the English master."
            : "Next: the checks run and findings appear as they arrive."}
        </p>
        {errors.form && (
          <p role="alert" className="w-full text-[13.5px] text-proof">
            {errors.form}
          </p>
        )}
      </div>
    </form>
  );
}
