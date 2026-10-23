"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, LoaderCircle, X } from "lucide-react";
import type { Channel, Lang } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { channelLabel, langLabel } from "@/components/format";

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

export function NewDraftForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<Channel>("instagram");
  const [lang, setLang] = useState<Lang>("en");
  const [body, setBody] = useState("");
  const [intent, setIntent] = useState("");
  const [locked, setLocked] = useState("");
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [loadingExample, setLoadingExample] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
                <Select {...p} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  {(Object.keys(langLabel) as Lang[]).map((l) => (
                    <option key={l} value={l}>
                      {langLabel[l]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
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
                className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rule-strong bg-sheet px-6 text-center text-[14px] text-muted hover:border-ink focus-within:border-ink"
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
        <p className="text-[13px] text-muted">Next: the checks run and findings appear as they arrive.</p>
        {errors.form && (
          <p role="alert" className="w-full text-[13.5px] text-proof">
            {errors.form}
          </p>
        )}
      </div>
    </form>
  );
}
