"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Lang, Persona } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { savePersonaAction } from "@/app/app/brand/actions";
import { langLabel } from "@/components/format";
import { SaveStatus, useSave } from "./useSave";

// Protected or sensitive attributes that should not define a simulated reader.
const PROTECTED: { re: RegExp; label: string }[] = [
  { re: /\b(hindu|muslim|christian|sikh|jain|buddhist|parsi|religio\w*)\b/i, label: "religion" },
  { re: /\b(caste|dalit|brahmin|OBC|SC\/ST|savarna)\b/i, label: "caste" },
  { re: /\b(race|racial|ethnic\w*|tribal)\b/i, label: "race or ethnicity" },
  { re: /\b(fair[- ]skinned|dark[- ]skinned|wheatish|skin colou?r|complexion)\b/i, label: "skin colour" },
  { re: /\b(gay|lesbian|bisexual|queer|trans\w*|sexual orientation)\b/i, label: "sexual orientation or gender identity" },
  { re: /\b(disab\w*|handicap\w*|wheelchair)\b/i, label: "disability" },
  { re: /\b(pregnan\w*|marital|married|divorc\w*|widow\w*)\b/i, label: "pregnancy or marital status" },
];

export function protectedHits(text: string) {
  return PROTECTED.filter((p) => p.re.test(text)).map((p) => p.label);
}

type Draft = { id?: string; name: string; description: string; lang: Lang };

function PersonaForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState(initial);
  const { pending, error, saved, save } = useSave();
  const hits = protectedHits(`${d.name} ${d.description}`);
  return (
    <form
      className="grid gap-3 rounded-md border border-rule-strong bg-sheet p-4 md:grid-cols-[1fr_160px]"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => savePersonaAction(d), `Saved “${d.name}”.`, onDone);
      }}
    >
      <Field label="Name">{(p) => <Input {...p} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
      <Field label="Reads in">
        {(p) => (
          <Select {...p} value={d.lang} onChange={(e) => setD({ ...d, lang: e.target.value as Lang })}>
            {(Object.keys(langLabel) as Lang[]).map((l) => (
              <option key={l} value={l}>
                {langLabel[l]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Description"
        className="md:col-span-2"
        hint="Describe needs, budget, context and skin concerns. Avoid protected attributes; they skew what the model assumes."
      >
        {(p) => <Textarea {...p} rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />}
      </Field>
      {hits.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-[5px] border border-ochre/40 bg-ochre-tint px-3 py-2 text-[13px] md:col-span-2">
          <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-ochre" />
          <span>
            This description mentions {hits.join(", ")}. A persona defined by a protected attribute invites stereotyped readings.
            Describe what the reader needs instead.
          </span>
        </p>
      )}
      <div className="flex items-center gap-2 md:col-span-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving" : "Save persona"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveStatus error={error} saved={saved} />
      </div>
    </form>
  );
}

export function PersonasTab({ personas, canEdit }: { personas: Persona[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const sorted = [...personas].sort((a, b) => Number(b.builtin) - Number(a.builtin));
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[72ch] text-[14px] leading-relaxed text-muted">
        Every check runs six readers: three built-in (literal first-time buyer, Hindi/Hinglish reader, ASCI code sceptic) and
        three brand personas defined here.
      </p>
      {canEdit && !editing && (
        <div>
          <Button size="sm" onClick={() => setEditing({ name: "", description: "", lang: "en" })}>
            Add a persona
          </Button>
        </div>
      )}
      {editing && !editing.id && <PersonaForm initial={editing} onDone={() => setEditing(null)} />}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((p) =>
          editing?.id === p.id ? (
            <li key={p.id} className="md:col-span-2 xl:col-span-3">
              <PersonaForm initial={editing} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border border-rule bg-sheet p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-[18px] leading-tight">{p.name}</p>
                <Badge>{p.builtin ? "Built-in" : langLabel[p.lang]}</Badge>
              </div>
              <p className="text-[13.5px] leading-relaxed text-muted">{p.description}</p>
              {protectedHits(`${p.name} ${p.description}`).length > 0 && (
                <p className="text-[12.5px] text-ochre">Mentions {protectedHits(`${p.name} ${p.description}`).join(", ")}.</p>
              )}
              {canEdit && !p.builtin && (
                <Button size="sm" variant="ghost" className="mt-auto self-start" onClick={() => setEditing({ id: p.id, name: p.name, description: p.description, lang: p.lang })}>
                  Edit<span className="sr-only"> {p.name}</span>
                </Button>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
