"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recheckFact } from "@/lib/recall/queue";
import {
  deleteTerm,
  getActor,
  importGuidelineClauses,
  updateBrand,
  upsertClause,
  upsertFact,
  upsertPersona,
  upsertTerm,
} from "@/lib/db/queries";
import type { Clause, ClauseKind, Fact, Lang, PaletteColor, Persona, Term, TermKind } from "@/lib/types";

export type BrandResult = { ok: true } | { ok: false; error: string };

async function wrap(fn: () => Promise<unknown>, fallback: string): Promise<BrandResult> {
  try {
    await fn();
    revalidatePath("/app/brand");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : fallback;
    if (/owner|permission|row-level|42501/i.test(msg)) return { ok: false, error: "Only the brand owner can edit Brand Space." };
    return { ok: false, error: msg || fallback };
  }
}

export async function saveClauseAction(c: {
  id?: string;
  code: string;
  title: string;
  body: string;
  kind: ClauseKind;
}): Promise<BrandResult> {
  if (!/^[A-Z]{1,3}-\d{1,3}$/.test(c.code.trim())) return { ok: false, error: "Codes look like G-12: letters, a hyphen, a number." };
  if (!c.title.trim() || !c.body.trim()) return { ok: false, error: "A clause needs a title and the rule text." };
  return wrap(
    () => upsertClause({ ...c, code: c.code.trim(), title: c.title.trim(), body: c.body.trim(), confirmed: true }),
    "The clause was not saved.",
  );
}

export async function importClausesAction(clauses: Omit<Clause, "id">[]): Promise<BrandResult> {
  if (!clauses.length) return { ok: false, error: "Select at least one clause to import." };
  return wrap(() => importGuidelineClauses(clauses.map((c) => ({ ...c, confirmed: true }))), "The clauses were not imported.");
}

export async function saveFactAction(f: {
  id?: string;
  code?: string;
  statement: string;
  source: string;
  owner: string;
  expires_on: string | null;
  status: Fact["status"];
}): Promise<BrandResult> {
  if (!f.statement.trim()) return { ok: false, error: "Write the fact as a full statement, with its numbers." };
  if (!f.source.trim()) return { ok: false, error: "Every fact needs a source, such as a study ID or certificate." };
  return wrap(async () => {
    const changed = await upsertFact({
      ...f,
      code: f.code?.trim() || undefined,
      statement: f.statement.trim(),
      source: f.source.trim(),
      owner: f.owner.trim(),
      expires_on: f.expires_on || null,
    });
    // a changed fact re-checks the live pages of every post that cited it, after the response is sent
    const actor = await getActor();
    if (changed && actor) after(() => recheckFact(actor.brand_id, changed, actor).catch(() => undefined));
    revalidatePath("/app/recall");
  }, "The fact was not saved.");
}

export async function saveTermAction(t: {
  id?: string;
  kind: TermKind;
  phrase: string;
  replacement: string | null;
  clause_code: string | null;
  triggers: string[] | null;
}): Promise<BrandResult> {
  if (!t.phrase.trim()) return { ok: false, error: "Enter the phrase to match." };
  if (t.kind === "disclaimer" && !t.triggers?.length) return { ok: false, error: "A disclaimer needs at least one trigger word." };
  const term: Partial<Term> & { kind: TermKind; phrase: string } = {
    ...t,
    phrase: t.phrase.trim(),
    replacement: t.replacement?.trim() || null,
    clause_code: t.clause_code?.trim() || null,
  };
  return wrap(() => upsertTerm(term), "The term was not saved.");
}

export async function deleteTermAction(id: string): Promise<BrandResult> {
  return wrap(() => deleteTerm(id), "The term was not deleted.");
}

export async function saveVoiceAction(traits: string[], palette: PaletteColor[]): Promise<BrandResult> {
  const bad = palette.find((p) => !/^#[0-9a-f]{6}$/i.test(p.hex));
  if (bad) return { ok: false, error: `“${bad.hex}” is not a 6-digit hex colour such as #E8A33D.` };
  return wrap(() => updateBrand(traits.filter(Boolean), palette), "Palette and voice were not saved.");
}

export async function savePersonaAction(p: { id?: string; name: string; description: string; lang: Lang }): Promise<BrandResult> {
  if (!p.name.trim() || !p.description.trim()) return { ok: false, error: "A persona needs a name and a description." };
  const persona: Partial<Persona> & { name: string; description: string } = { ...p, builtin: false };
  return wrap(() => upsertPersona(persona), "The persona was not saved.");
}
