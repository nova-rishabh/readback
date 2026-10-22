"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Clause, Term, TermKind } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { deleteTermAction, saveTermAction } from "@/app/app/brand/actions";
import { SaveStatus, useSave } from "./useSave";

const GROUPS: { kind: TermKind; title: string; about: string }[] = [
  { kind: "banned", title: "Banned", about: "Flagged wherever they appear, with the replacement offered as a fix." },
  { kind: "disclaimer", title: "Required disclaimers", about: "Must appear whenever one of the trigger words does." },
  { kind: "embargo", title: "Embargoed", about: "Unreleased names. Flagged in drafts and masked before any model call." },
  { kind: "preferred", title: "Preferred", about: "House wording the reader panel favours in tone checks." },
];

export function TermsTab({ terms, clauses, canEdit }: { terms: Term[]; clauses: Clause[]; canEdit: boolean }) {
  const [kind, setKind] = useState<TermKind>("banned");
  const [phrase, setPhrase] = useState("");
  const [replacement, setReplacement] = useState("");
  const [clause, setClause] = useState("");
  const [triggers, setTriggers] = useState("");
  const { pending, error, saved, save } = useSave();
  const del = useSave();

  return (
    <div className="flex flex-col gap-8">
      {canEdit && (
        <form
          className="grid gap-3 rounded-md border border-rule bg-sheet p-4 md:grid-cols-[150px_1fr_1fr_120px]"
          onSubmit={(e) => {
            e.preventDefault();
            save(
              () =>
                saveTermAction({
                  kind,
                  phrase,
                  replacement: kind === "banned" ? replacement : null,
                  clause_code: clause || null,
                  triggers: kind === "disclaimer" ? triggers.split(/[|,]/).map((s) => s.trim()).filter(Boolean) : null,
                }),
              `Added “${phrase}”.`,
              () => {
                setPhrase("");
                setReplacement("");
                setTriggers("");
              },
            );
          }}
        >
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as TermKind)}>
                {GROUPS.map((g) => (
                  <option key={g.kind} value={g.kind}>
                    {g.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={kind === "disclaimer" ? "Disclaimer text" : "Phrase"}>
            {(p) => <Input {...p} value={phrase} onChange={(e) => setPhrase(e.target.value)} />}
          </Field>
          {kind === "banned" ? (
            <Field label="Suggested replacement" optional>
              {(p) => <Input {...p} value={replacement} onChange={(e) => setReplacement(e.target.value)} />}
            </Field>
          ) : kind === "disclaimer" ? (
            <Field label="Trigger words" hint="Separate with commas.">
              {(p) => <Input {...p} value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder="results, visible, % saw" />}
            </Field>
          ) : (
            <div />
          )}
          <Field label="Clause" optional>
            {(p) => (
              <Select {...p} value={clause} onChange={(e) => setClause(e.target.value)}>
                <option value="">None</option>
                {clauses.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-center gap-3 md:col-span-4">
            <Button type="submit" size="sm" variant="primary" disabled={pending || !phrase.trim()}>
              {pending ? "Adding" : "Add term"}
            </Button>
            <SaveStatus error={error} saved={saved} />
          </div>
        </form>
      )}
      <SaveStatus error={del.error} saved={del.saved} />

      {GROUPS.map((g) => {
        const list = terms.filter((t) => t.kind === g.kind);
        return (
          <section key={g.kind} aria-labelledby={`terms-${g.kind}`}>
            <div className="mb-2 flex items-baseline gap-3 border-b border-rule pb-1.5">
              <h3 id={`terms-${g.kind}`} className="font-display text-[19px]">
                {g.title}
              </h3>
              <p className="text-[13px] text-muted">{g.about}</p>
            </div>
            {list.length === 0 ? (
              <p className="py-2 text-[13.5px] text-muted">None.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {list.map((t) => (
                  <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_40px] items-center gap-3 py-2 text-[14px]">
                    <span className="font-display text-[16px]">&ldquo;{t.phrase}&rdquo;</span>
                    <span className="text-[13px] text-muted">
                      {t.kind === "banned" && t.replacement && (
                        <>
                          Use <span className="text-ink">&ldquo;{t.replacement}&rdquo;</span>
                        </>
                      )}
                      {t.kind === "disclaimer" && t.triggers?.length ? <>When: {t.triggers.join(", ")}</> : null}
                    </span>
                    <span className="font-mono text-[12px] text-muted">{t.clause_code ?? ""}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Delete “${t.phrase}”`}
                        disabled={del.pending}
                        onClick={() => {
                          if (window.confirm(`Delete “${t.phrase}”? Future checks stop flagging it.`)) del.save(() => deleteTermAction(t.id), `Deleted “${t.phrase}”.`);
                        }}
                        className="justify-self-end rounded p-1 text-muted hover:text-proof"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
