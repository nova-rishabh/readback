// Span fix + re-read gate: rewrite only the trigger span (never locked phrases), splice it in, and re-run the
// whole panel in ONE batched structured call to decide whether the fix is safe.
import { z } from "zod";
import type { BeliefCategory, BrandSpace, Persona, Span, Suggestion } from "../types";
import { mockFix, mockReread } from "./mock";
import { callObject, isMock, type Img } from "./provider";
import { CATEGORIES } from "./reader";
import { toneConflict } from "./tone";
import { describeFact } from "./verify";

const ranges = (text: string, locked: string[]): [number, number][] =>
  locked.flatMap((p) => {
    if (!p.trim()) return [];
    const out: [number, number][] = [];
    const lo = text.toLowerCase(), q = p.toLowerCase();
    for (let i = lo.indexOf(q); i >= 0; i = lo.indexOf(q, i + 1)) out.push([i, i + q.length]);
    return out;
  });

/** Shrink the span so it never overlaps a locked phrase; null when nothing editable is left. */
export function trimSpan(text: string, span: Span, locked: string[]): Span | null {
  let { start, end } = span;
  for (const [a, b] of ranges(text, locked)) {
    if (b <= start || a >= end) continue;
    if (a <= start && b >= end) return null;
    if (a > start && b < end) return null; // locked phrase strictly inside
    if (a <= start) start = b;
    else end = a;
  }
  const t = text.slice(start, end);
  return t.trim() ? { start, end, text: t } : null;
}

export const splice = (text: string, s: Span, rep: string) => text.slice(0, s.start) + rep + text.slice(s.end);

const count = (text: string, p: string) => ranges(text, [p]).length;
export const lockedIntact = (before: string, after: string, locked: string[]) =>
  locked.every((p) => count(after, p) >= count(before, p));

const fixSchema = z.object({ replacement: z.string(), rationale: z.string() });

export interface FixArgs {
  draft: string;
  span: Span;
  kind: "claim" | "tone";
  belief: string | null;
  reason: string;
  intent: string;
  locked: string[];
  brand: BrandSpace;
  panel: Persona[];
  image: Img | null;
  flagged: string[]; // statements of every contradicted/unsupported belief in the draft
  embargo: string[];
}

async function proposeFix(a: FixArgs): Promise<{ replacement: string; rationale: string } | null> {
  if (isMock()) return mockFix(a.kind === "tone" ? null : a.belief, a.span.text);
  const facts = a.brand.facts.filter((f) => f.status === "active").map(describeFact).join("\n");
  const marked = `${a.draft.slice(0, a.span.start)}[[${a.span.text}]]${a.draft.slice(a.span.end)}`;
  try {
    const o = await callObject({
      schema: fixSchema,
      system: `You are a careful copy editor for ${a.brand.name}. You rewrite exactly one marked span of a draft so it is truthful, and change as little as possible.`,
      prompt: [
        `DRAFT (span to rewrite is inside [[ ]]):\n${marked}`,
        a.kind === "claim"
          ? `PROBLEM: readers believe "${a.belief}". ${a.reason}`
          : `PROBLEM: the tone reads as pushy, against the brand voice (${a.brand.voice_traits.join(", ")}). Keep the call to action but remove the pressure.`,
        `DECLARED INTENT (must still come across): ${a.intent}`,
        `LOCKED PHRASES (never alter, never contradict): ${a.locked.length ? a.locked.map((p) => `"${p}"`).join(", ") : "none"}`,
        `APPROVED FACTS (use their wording and numbers where possible):\n${facts || "none"}`,
        "Rules: return only the replacement for the marked span, in the same language and register, about the same length. Preserve the creator's purpose. Do not add claims that are not in the approved facts. A measured result may end with * so a disclaimer can attach.",
        'Example: "Visible glow in 7 days" -> "71% saw more radiant skin in 4 weeks*" (from fact "71% saw more radiant skin at week 4").',
      ].join("\n\n"),
      embargo: a.embargo,
    });
    return o.replacement.trim() ? o : null;
  } catch {
    return null;
  }
}

// ---------- re-read gate ----------

const rereadSchema = z.object({
  readers: z.array(
    z.object({
      persona: z.string(),
      intent_match: z.boolean(),
      tone: z.array(z.string()),
      beliefs: z.array(
        z.object({
          belief: z.string(),
          category: z.enum(CATEGORIES),
          verdict: z.enum(["ok", "contradicted", "unsupported"]),
          matches_flagged: z.number().nullable(),
        }),
      ),
    }),
  ),
});

export interface RereadReader {
  intent_match: boolean;
  tone: string[];
  beliefs: { category: BeliefCategory; verdict: "ok" | "contradicted" | "unsupported"; matches_flagged: number | null }[];
}

export function scoreReread(
  rs: RereadReader[],
  nFlagged: number,
  o: { lockedOk: boolean; tone: boolean; voice: string[] },
): NonNullable<Suggestion["reread"]> {
  const of = rs.length;
  const min = Math.min(2, Math.max(1, of));
  const bad = rs.map((r) => r.beliefs.filter((b) => b.verdict !== "ok"));
  let held = 0;
  for (let i = 0; i < nFlagged; i++) if (bad.filter((bs) => bs.some((b) => b.matches_flagged === i)).length >= min) held++;
  const fresh = new Map<string, number>();
  bad.forEach((bs) => new Set(bs.filter((b) => b.matches_flagged === null).map((b) => b.category)).forEach((c) => fresh.set(c, (fresh.get(c) ?? 0) + 1)));
  const newUnsupported = [...fresh.values()].filter((n) => n >= min).length;
  const after = held + newUnsupported;
  const kept = rs.filter((r) => r.intent_match).length;
  const dropped = o.tone ? after <= nFlagged && !toneConflict(rs.map((r) => r.tone), o.voice).majority : after < nFlagged;
  return {
    passed: o.lockedOk && dropped && newUnsupported === 0 && kept * 2 > of,
    unsupported_before: nFlagged,
    unsupported_after: after,
    new_unsupported: newUnsupported,
    intent_kept: kept,
    of,
  };
}

async function rereadPanel(a: FixArgs, text: string): Promise<RereadReader[]> {
  if (isMock()) return mockReread(text, a.panel.length, a.flagged);
  const o = await callObject({
    schema: rereadSchema,
    system: "You simulate several different readers of a marketing post. Each reader is independent and reports only what they would believe after a 5-second read.",
    prompt: [
      `POST TEXT:\n"""\n${text}\n"""`,
      `DECLARED INTENT: ${a.intent}`,
      `READERS (answer in this order, one entry each):\n${a.panel.map((p, i) => `${i}. ${p.name}: ${p.description}`).join("\n")}`,
      `FACT LEDGER:\n${a.brand.facts.filter((f) => f.status === "active").map(describeFact).join("\n") || "none"}`,
      `PREVIOUSLY FLAGGED BELIEFS:\n${a.flagged.map((f, i) => `${i}. ${f}`).join("\n") || "none"}`,
      "For each reader list the distinct beliefs they take away (including implied ones) and tone adjectives. verdict: ok = backed by an active ledger fact or not a checkable claim; contradicted = conflicts with a fact; unsupported = checkable but not backed. matches_flagged = index of the flagged belief this is essentially the same as, else null. intent_match = reader gets the declared intent.",
    ].join("\n\n"),
    image: a.image,
    embargo: a.embargo,
    temperature: 0,
  });
  return o.readers;
}

/** Propose a span-only rewrite and gate it with a panel re-read. Null when no usable rewrite exists. */
export async function fixAndGate(a: FixArgs): Promise<Suggestion | null> {
  const fix = await proposeFix(a);
  if (!fix || fix.replacement === a.span.text) return null;
  const spliced = splice(a.draft, a.span, fix.replacement);
  const lockedOk = lockedIntact(a.draft, spliced, a.locked);
  let reread: Suggestion["reread"] = null;
  try {
    reread = scoreReread(await rereadPanel(a, spliced), a.flagged.length, { lockedOk, tone: a.kind === "tone", voice: a.brand.voice_traits });
  } catch {
    /* re-read failed: unverified fixes are never presented as safe */
  }
  if (!reread) reread = { passed: false, unsupported_before: a.flagged.length, unsupported_after: a.flagged.length, new_unsupported: 0, intent_kept: 0, of: a.panel.length };
  return { replacement: fix.replacement, rationale: fix.rationale, reread };
}
