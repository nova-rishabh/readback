"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { DriftKind, DriftResult, DriftRow } from "@/lib/ai/drift";
import type { Lang } from "@/lib/types";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";

const EXAMPLE = {
  master: "Velura Vitamin C serum. 71% saw more radiant skin in 4 weeks.* Gentle enough for daily use.\n*Results may vary.",
  variant: "Velura Vitamin C सीरम। 4 हफ्तों में पक्का निखार। रोज़ इस्तेमाल के लिए सौम्य।",
};

const KIND: Record<DriftKind, { label: string; tone: Tone }> = {
  new_belief: { label: "Added in translation", tone: "proof" },
  strengthened: { label: "Made stronger", tone: "proof" },
  dropped: { label: "Dropped", tone: "ochre" },
  weakened: { label: "Weakened", tone: "steel" },
  same: { label: "Same", tone: "moss" },
};
const STRENGTH = ["", "hedged", "plain", "absolute"];

function Side({ s, of }: { s: DriftRow["master"]; of: number }) {
  if (!s) return <span className="text-[13px] text-muted">Not formed</span>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[14px]">{s.belief}</span>
      {s.quote && <span className="font-display text-[14px] italic text-muted">“{s.quote}”</span>}
      <span className="font-mono text-[11.5px] text-muted">
        {s.readers} of {of} readers · {STRENGTH[Math.min(3, Math.max(1, Math.round(s.strength)))]}
      </span>
    </div>
  );
}

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
        headers: { "content-type": "application/json" },
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
            {(p) => <Textarea {...p} rows={5} value={variant} onChange={(e) => setVariant(e.target.value)} lang={lang === "hi" ? "hi" : undefined} required />}
          </Field>
          <Field label="Language">
            {(p) => (
              <Select {...p} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="hi">Hindi</option>
                <option value="hinglish">Hinglish</option>
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
          <div className="overflow-x-auto rounded-md border border-rule">
            <table className="w-full min-w-[760px] border-collapse bg-sheet text-left">
              <caption className="sr-only">Beliefs formed from each version</caption>
              <thead>
                <tr className="border-b border-rule-strong text-[12.5px] text-muted">
                  <th scope="col" className="w-[170px] px-4 py-2 font-medium">Change</th>
                  <th scope="col" className="px-4 py-2 font-medium">English master</th>
                  <th scope="col" className="px-4 py-2 font-medium">Translated version</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-rule align-top last:border-0">
                    <td className="px-4 py-3">
                      <Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge>
                      <p className="mt-2 text-[12.5px] text-muted">{r.explanation}</p>
                    </td>
                    <td className="px-4 py-3"><Side s={r.master} of={result.of} /></td>
                    <td className="px-4 py-3" lang={lang === "hi" ? "hi" : undefined}><Side s={r.variant} of={result.of} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
