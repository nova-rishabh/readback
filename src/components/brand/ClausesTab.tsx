"use client";

import { useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import type { Clause, ClauseKind } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { importClausesAction, saveClauseAction } from "@/app/app/brand/actions";
import { SaveStatus, useSave } from "./useSave";

type Draft = { id?: string; code: string; title: string; body: string; kind: ClauseKind };

function ClauseForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState(initial);
  const { pending, error, saved, save } = useSave();
  return (
    <form
      className="grid gap-3 rounded-md border border-rule-strong bg-sheet p-4 md:grid-cols-[120px_1fr_140px]"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveClauseAction(d), `Saved ${d.code}.`, onDone);
      }}
    >
      <Field label="Code">{(p) => <Input {...p} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} className="font-mono" />}</Field>
      <Field label="Title">{(p) => <Input {...p} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />}</Field>
      <Field label="Checked by">
        {(p) => (
          <Select {...p} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as ClauseKind })}>
            <option value="rule">Rule engine</option>
            <option value="ai">Reader panel</option>
          </Select>
        )}
      </Field>
      <Field label="Rule text" className="md:col-span-3">
        {(p) => <Textarea {...p} rows={3} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />}
      </Field>
      <div className="flex items-center gap-2 md:col-span-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving" : "Save clause"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

function Importer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [found, setFound] = useState<(Omit<Clause, "id"> & { keep: boolean })[] | null>(null);
  const [source, setSource] = useState("");
  const { pending, error, saved, save } = useSave();

  async function parse(file: File) {
    setParsing(true);
    setParseError(null);
    setFound(null);
    const fd = new FormData();
    fd.set("file", file);
    try {
      const res = await fetch("/api/guidelines/parse", { method: "POST", body: fd });
      const j = (await res.json()) as { clauses?: Omit<Clause, "id">[]; error?: string; file?: string };
      if (!res.ok || !j.clauses) throw new Error(j.error ?? `The server answered ${res.status}.`);
      setFound(j.clauses.map((c) => ({ ...c, keep: true })));
      setSource(j.file ?? file.name);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const kept = found?.filter((c) => c.keep) ?? [];

  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium">Import a guideline document</p>
          <p className="text-[13px] text-muted">PDF, DOCX or TXT. Numbered sections become clauses; you confirm each one before it applies.</p>
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[5px] border border-rule-strong bg-sheet px-3.5 text-sm font-medium hover:border-ink focus-within:outline-2 focus-within:outline-ink">
          {parsing ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <FileUp size={14} aria-hidden />}
          {parsing ? "Reading file" : "Choose file"}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
            className="sr-only"
            disabled={parsing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void parse(f);
            }}
          />
        </label>
      </div>
      {parseError && (
        <p role="alert" className="mt-3 text-[13px] text-proof">
          {parseError}
        </p>
      )}
      {found && (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-muted">
            Found {found.length} clause{found.length === 1 ? "" : "s"} in <span className="font-mono">{source}</span>. Untick any that
            are not rules, and check which engine each belongs to.
          </p>
          <ul className="max-h-[420px] divide-y divide-rule overflow-y-auto rounded-[5px] border border-rule">
            {found.map((c, i) => (
              <li key={c.code} className="grid grid-cols-[auto_64px_1fr_130px] items-start gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`Import ${c.code}`}
                  checked={c.keep}
                  onChange={(e) => setFound(found.map((x, k) => (k === i ? { ...x, keep: e.target.checked } : x)))}
                  className="mt-1 size-4 accent-ink"
                />
                <span className="font-mono text-[12.5px]">{c.code}</span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{c.title}</p>
                  <p className="line-clamp-2 text-[12.5px] text-muted">{c.body}</p>
                </div>
                <select
                  aria-label={`Engine for ${c.code}`}
                  value={c.kind}
                  onChange={(e) => setFound(found.map((x, k) => (k === i ? { ...x, kind: e.target.value as ClauseKind } : x)))}
                  className="h-8 rounded-[4px] border border-rule-strong bg-sheet px-2 text-[12.5px]"
                >
                  <option value="rule">Rule engine</option>
                  <option value="ai">Reader panel</option>
                </select>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={pending || kept.length === 0}
              onClick={() =>
                save(
                  () => importClausesAction(kept.map(({ keep: _k, ...c }) => c)),
                  `Imported ${kept.length} clauses.`,
                  () => setFound(null),
                )
              }
            >
              {pending ? "Importing" : `Confirm ${kept.length} clause${kept.length === 1 ? "" : "s"}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFound(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      <div className="mt-2">
        <SaveStatus error={error} saved={saved} />
      </div>
    </div>
  );
}

export function ClausesTab({ clauses, canEdit }: { clauses: Clause[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const sorted = [...clauses].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const nextCode = `G-${String(sorted.reduce((m, c) => Math.max(m, Number(c.code.match(/(\d+)$/)?.[1] ?? 0)), 0) + 1).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-5">
      {canEdit && <Importer />}
      {canEdit && !editing && (
        <div>
          <Button size="sm" onClick={() => setEditing({ code: nextCode, title: "", body: "", kind: "rule" })}>
            Add a clause
          </Button>
        </div>
      )}
      {editing && !editing.id && <ClauseForm initial={editing} onDone={() => setEditing(null)} />}

      {sorted.length === 0 ? (
        <p className="text-[14px] text-muted">No clauses yet. Import the brand guideline PDF to start.</p>
      ) : (
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">Guideline clauses</caption>
          <thead>
            <tr className="border-b border-rule-strong text-left text-[12.5px] text-muted">
              <th scope="col" className="w-20 py-2 pr-3 font-medium">Code</th>
              <th scope="col" className="py-2 pr-3 font-medium">Clause</th>
              <th scope="col" className="w-36 py-2 pr-3 font-medium">Checked by</th>
              {canEdit && <th scope="col" className="w-16 py-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) =>
              editing?.id === c.id ? (
                <tr key={c.id}>
                  <td colSpan={4} className="py-2">
                    <ClauseForm initial={editing} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={c.id} className="border-b border-rule align-top">
                  <td className="py-2.5 pr-3 font-mono text-[12.5px]">{c.code}</td>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium">
                      {c.title}
                      {!c.confirmed && (
                        <Badge tone="ochre" className="ml-2">
                          Not confirmed
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 max-w-[80ch] text-[13px] leading-relaxed text-muted">{c.body}</p>
                  </td>
                  <td className="py-2.5 pr-3 text-[13px]">
                    <span className="font-mono text-[11.5px]">{c.kind === "rule" ? "[RULE]" : "[AI]"}</span>{" "}
                    {c.kind === "rule" ? "Rule engine" : "Reader panel"}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, code: c.code, title: c.title, body: c.body, kind: c.kind })}>
                        Edit<span className="sr-only"> {c.code}</span>
                      </Button>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
