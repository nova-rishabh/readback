"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { PaletteColor } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { saveVoiceAction } from "@/app/app/brand/actions";
import { SaveStatus, useSave } from "./useSave";

export function VoiceTab({ traits, palette, canEdit }: { traits: string[]; palette: PaletteColor[]; canEdit: boolean }) {
  const [t, setT] = useState(traits.join(", "));
  const [pal, setPal] = useState<PaletteColor[]>(palette);
  const { pending, error, saved, save } = useSave();

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          () => saveVoiceAction(t.split(",").map((s) => s.trim()).filter(Boolean), pal),
          "Saved. New checks use this palette and voice.",
        );
      }}
    >
      <section aria-labelledby="pal-h">
        <h3 id="pal-h" className="font-display text-[19px]">
          Palette
        </h3>
        <p className="mt-0.5 mb-3 text-[13px] text-muted">
          Image colours covering more than 8% of pixels are compared to these. A distance above ΔE 20 raises a low-severity flag.
        </p>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pal.map((c, i) => (
            <li key={i} className="overflow-hidden rounded-md border border-rule bg-sheet">
              <div className="h-20 border-b border-rule" style={{ background: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent" }} aria-hidden />
              {canEdit ? (
                <div className="flex flex-col gap-1.5 p-2.5">
                  <Input aria-label={`Colour ${i + 1} name`} value={c.name} onChange={(e) => setPal(pal.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="h-8 text-[13px]" />
                  <div className="flex gap-1.5">
                    <Input
                      aria-label={`Colour ${i + 1} hex`}
                      value={c.hex}
                      onChange={(e) => setPal(pal.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)))}
                      className="h-8 font-mono text-[12.5px]"
                    />
                    <button type="button" aria-label={`Remove ${c.name || "colour"}`} onClick={() => setPal(pal.filter((_, k) => k !== i))} className="rounded px-1 text-muted hover:text-proof">
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2.5">
                  <p className="text-[13.5px] font-medium">{c.name}</p>
                  <p className="font-mono text-[12px] text-muted">{c.hex}</p>
                </div>
              )}
            </li>
          ))}
          {canEdit && (
            <li>
              <button
                type="button"
                onClick={() => setPal([...pal, { name: "", hex: "#" }])}
                className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-rule-strong text-[13px] text-muted hover:border-ink hover:text-ink"
              >
                <Plus size={16} aria-hidden /> Add colour
              </button>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="voice-h" className="max-w-[640px]">
        <h3 id="voice-h" className="font-display text-[19px]">
          Voice
        </h3>
        {canEdit ? (
          <Field label="Voice traits" hint="Comma-separated. When most readers describe the tone with a word that conflicts with these, a tone finding is raised.">
            {(p) => <Input {...p} value={t} onChange={(e) => setT(e.target.value)} />}
          </Field>
        ) : (
          <p className="mt-2 font-display text-[18px]">{traits.join(", ") || "No voice traits set."}</p>
        )}
      </section>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving" : "Save palette and voice"}
          </Button>
          <SaveStatus error={error} saved={saved} />
        </div>
      )}
    </form>
  );
}
