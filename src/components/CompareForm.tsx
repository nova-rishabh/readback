"use client";

import { keyHeaders } from "@/lib/client/gemini-key";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { DriftResult } from "@/lib/ai/drift";
import type { Lang } from "@/lib/types";
import { LANG_NAME, LANG_TAG } from "@/lib/lang";
import { Button } from "@/components/ui/Button";
import { DriftTable } from "@/components/DriftTable";
import { Field, Select, Textarea } from "@/components/ui/Field";

const EXAMPLE = {
  master: "Velura Vitamin C serum. 71% saw more radiant skin in 4 weeks.* Gentle enough for daily use.\n*Results may vary.",
  variant: "Velura Vitamin C सीरम। 4 हफ्तों में पक्का निखार। रोज़ इस्तेमाल के लिए सौम्य।",
};

export function CompareForm() {
  const [master, setMaster] = useState("");
  const [variant, setVariant] = useState("");
  const [lang, setLang] = useState<Lang>("hi");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DriftResult | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/drift", {
        method: "POST",
        headers: { "content-type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ master, variant, variantLang: lang }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The comparison failed.");
      setResult(j as DriftResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The comparison failed.");
    } finally {
      setPending(false);
    }
  }

  const flagged = result?.rows.filter((r) => r.kind === "new_belief" || r.kind === "strengthened").length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4 rounded-md border border-rule bg-sheet px-4 py-3">
        <p className="text-[13.5px] text-muted">
          Try the Velura case: the English line promises a gradual result; the agency&apos;s Hindi adds <span lang="hi" className="font-medium text-ink">पक्का</span> (“guaranteed”).
        </p>
        <Button type="button" size="sm" onClick={() => (setMaster(EXAMPLE.master), setVariant(EXAMPLE.variant), setLang("hi"))}>
          Load Velura example
        </Button>
      </div>

      <form
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field label="English master (required)" hint="The approved source version.">
          {(p) => <Textarea {...p} rows={5} value={master} onChange={(e) => setMaster(e.target.value)} required />}
        </Field>
        <div className="flex flex-col gap-3">
          <Field label="Translated version (required)" hint="The agency or regional copy to check.">
            {(p) => <Textarea {...p} rows={5} value={variant} onChange={(e) => setVariant(e.target.value)} lang={LANG_TAG[lang]} required />}
          </Field>
          <Field label="Language">
            {(p) => (
              <Select {...p} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                {(["hi", "hinglish", "ta", "mr"] as Lang[]).map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAME[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex items-center gap-3 lg:col-span-2">
          <Button type="submit" variant="primary" disabled={pending || !master.trim() || !variant.trim()}>
            {pending && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
            {pending ? "Comparing… usually under 20 seconds" : "Compare translation"}
          </Button>
          <p role="alert" className="text-[13px] text-proof">
            {error}
          </p>
        </div>
      </form>

      {!result && (
        <p className="text-[13.5px] text-muted">Results appear here: what readers believe from each version, side by side.</p>
      )}

      {result && (
        <section aria-labelledby="drift-h" aria-live="polite" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="drift-h" className="font-display text-[22px]">
              {flagged ? `${flagged} belief${flagged > 1 ? "s" : ""} changed in translation` : "Both versions leave the same beliefs"}
            </h2>
            <span className="font-mono text-[12px] text-muted">
              [AI] {result.model}
              {result.clause && ` · Clause ${result.clause.code}`}
            </span>
          </div>
          {result.clause && <p className="text-[13.5px] text-muted">{result.clause.code}: {result.clause.title}.</p>}
          <DriftTable rows={result.rows} of={result.of} lang={lang} />
          <p className="text-[13px] text-muted">
            This is a one-off comparison and is not saved. To keep the result with the review, open the English draft and
            choose <span className="text-ink">Add a translation</span>: every version of a linked translation is compared with
            its master automatically, and changes become findings a reviewer must resolve.
          </p>
        </section>
      )}
    </div>
  );
}
