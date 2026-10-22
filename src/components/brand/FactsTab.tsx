"use client";

import { useState } from "react";
import type { Fact } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { saveFactAction } from "@/app/app/brand/actions";
import { fmtDate, relDays } from "@/components/format";
import { SaveStatus, useSave } from "./useSave";

type Draft = {
  id?: string;
  code?: string;
  statement: string;
  source: string;
  owner: string;
  expires_on: string | null;
  status: Fact["status"];
};

function Expiry({ f }: { f: Fact }) {
  const d = relDays(f.expires_on);
  if (f.status === "retired") return <Badge>Retired</Badge>;
  if (f.status === "expired" || (d !== null && d < 0)) return <Badge tone="proof">Expired {fmtDate(f.expires_on)}</Badge>;
  if (d !== null && d <= 30) return <Badge tone="ochre">Expires in {d} day{d === 1 ? "" : "s"}</Badge>;
  if (!f.expires_on) return <span className="text-[13px] text-muted">No expiry</span>;
  return <span className="text-[13px] tabular-nums">{fmtDate(f.expires_on)}</span>;
}

function FactForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState(initial);
  const { pending, error, saved, save } = useSave();
  return (
    <form
      className="grid gap-3 rounded-md border border-rule-strong bg-sheet p-4 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveFactAction(d), d.id ? `Saved ${d.code}. Version bumped; posts citing it were queued for recall review.` : "Fact added.", onDone);
      }}
    >
      <Field label="Statement" className="md:col-span-2" hint="Write it the way it may be claimed, with numbers and conditions.">
        {(p) => <Textarea {...p} rows={2} value={d.statement} onChange={(e) => setD({ ...d, statement: e.target.value })} className="font-display text-[16px]" />}
      </Field>
      <Field label="Source">{(p) => <Input {...p} value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })} placeholder="Clinical study VEL-CS-2025-03" />}</Field>
      <Field label="Owner">{(p) => <Input {...p} value={d.owner} onChange={(e) => setD({ ...d, owner: e.target.value })} placeholder="R&D, Dr. Kavya Rao" />}</Field>
      <Field label="Expires on" optional>
        {(p) => <Input {...p} type="date" value={d.expires_on ?? ""} onChange={(e) => setD({ ...d, expires_on: e.target.value || null })} />}
      </Field>
      <Field label="Status">
        {(p) => (
          <Select {...p} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Fact["status"] })}>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="retired">Retired</option>
          </Select>
        )}
      </Field>
      {d.id && (
        <p className="text-[12.5px] text-ochre md:col-span-2">
          Saving bumps {d.code} to a new version. Published posts that cited the old version go to the Recall queue.
        </p>
      )}
      <div className="flex items-center gap-2 md:col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving" : d.id ? `Save ${d.code}` : "Add fact"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

export function FactsTab({ facts, canEdit }: { facts: Fact[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const sorted = [...facts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[72ch] text-[14px] leading-relaxed text-muted">
        Reader beliefs are checked against these statements. A belief with no matching fact is reported as unsupported, never
        as false.
      </p>
      {canEdit && !editing && (
        <div>
          <Button size="sm" onClick={() => setEditing({ statement: "", source: "", owner: "", expires_on: null, status: "active" })}>
            Add a fact
          </Button>
        </div>
      )}
      {editing && !editing.id && <FactForm initial={editing} onDone={() => setEditing(null)} />}
      {sorted.length === 0 ? (
        <p className="text-[14px] text-muted">The ledger is empty, so every claim a reader believes will show as unsupported.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[14px]">
            <caption className="sr-only">Fact Ledger</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-[12.5px] text-muted">
                <th scope="col" className="w-16 py-2 pr-3 font-medium">Code</th>
                <th scope="col" className="py-2 pr-3 font-medium">Statement</th>
                <th scope="col" className="w-56 py-2 pr-3 font-medium">Source</th>
                <th scope="col" className="w-14 py-2 pr-3 font-medium">Ver.</th>
                <th scope="col" className="w-40 py-2 pr-3 font-medium">Expiry</th>
                {canEdit && <th scope="col" className="w-16 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) =>
                editing?.id === f.id ? (
                  <tr key={f.id}>
                    <td colSpan={6} className="py-2">
                      <FactForm initial={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={f.id} className="border-b border-rule align-top">
                    <td className="py-2.5 pr-3 font-mono text-[12.5px]">{f.code}</td>
                    <td className="py-2.5 pr-3 font-display text-[15.5px] leading-snug">{f.statement}</td>
                    <td className="py-2.5 pr-3 text-[13px]">
                      {f.source}
                      {f.owner && <div className="text-[12px] text-muted">{f.owner}</div>}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[12.5px]">v{f.version}</td>
                    <td className="py-2.5 pr-3">
                      <Expiry f={f} />
                    </td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditing({
                              id: f.id,
                              code: f.code,
                              statement: f.statement,
                              source: f.source,
                              owner: f.owner,
                              expires_on: f.expires_on,
                              status: f.status,
                            })
                          }
                        >
                          Edit<span className="sr-only"> {f.code}</span>
                        </Button>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
