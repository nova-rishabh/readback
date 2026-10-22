// One simulated reader: a single generateObject call per persona (image attached), or a mock reader offline.
import { z } from "zod";
import type { Persona, ReaderResult } from "../types";
import { mockReader } from "./mock";
import { readerPrompt, type ReadCtx } from "./personas";
import { callObject, isMock } from "./provider";

export const CATEGORIES = ["efficacy", "health", "environment", "price", "guarantee", "comparison", "endorsement", "urgency"] as const;

const readerSchema = z.object({
  takeaway: z.string(),
  tone: z.array(z.string()),
  intent_match: z.boolean(),
  beliefs: z.array(
    z.object({
      belief: z.string(),
      trigger_quote: z.string(),
      visual_element: z.string().nullable(),
      category: z.enum(CATEGORIES),
      confidence: z.number(),
    }),
  ),
});

export async function readPersona(persona: Persona, idx: number, ctx: ReadCtx): Promise<ReaderResult> {
  if (isMock()) return mockReader(persona, idx, ctx);
  const { system, prompt } = readerPrompt(persona, ctx);
  const o = await callObject({ schema: readerSchema, system, prompt, image: ctx.image, embargo: ctx.embargo });
  return {
    persona_id: persona.id,
    persona_name: persona.name,
    takeaway: o.takeaway,
    tone: o.tone.map((t) => t.toLowerCase().trim()).filter(Boolean),
    intent_match: o.intent_match,
    beliefs: o.beliefs
      .filter((b) => b.belief.trim())
      .map((b) => ({ ...b, confidence: Math.min(1, Math.max(0, b.confidence)), grounded: false })),
  };
}

const panelSchema = z.object({ readers: z.array(readerSchema.extend({ persona_id: z.string() })) });

/**
 * The whole panel in ONE structured call (free-tier Gemini allows 5 requests/min per model). Each persona is
 * simulated in isolation inside the prompt; personas the model leaves out are dropped, as a failed reader would be.
 */
export async function readPanel(panel: Persona[], ctx: ReadCtx): Promise<ReaderResult[]> {
  if (isMock()) return Promise.all(panel.map((p, i) => mockReader(p, i, ctx)));
  const { prompt } = readerPrompt(panel[0], ctx);
  const tasks = prompt.slice(prompt.indexOf("Tasks:"));
  const o = await callObject({
    schema: panelSchema,
    system: [
      `You simulate ${panel.length} different people, each reading the same ${ctx.channel} post for about 5 seconds.`,
      "Simulate every reader in isolation: one reader's reading must not influence another's. Readers can disagree.",
      "Report what each reader BELIEVES after reading, not what is strictly stated.",
    ].join("\n"),
    prompt: [
      `Brand: ${ctx.brandName}. Post language: ${ctx.lang}.${ctx.image ? " The post image is attached." : " There is no image."}`,
      `POST TEXT:\n"""\n${ctx.text}\n"""`,
      `The creator's declared intended takeaway: "${ctx.intent}"`,
      `READERS (return exactly one entry per persona_id):\n${panel
        .map((p) => `- persona_id "${p.id}": ${p.name}. ${p.description}${p.lang !== "en" ? " Reads in Hindi/Hinglish; writes beliefs in English but copies trigger_quote exactly." : ""}`)
        .join("\n")}`,
      `For EACH reader, independently:\n${tasks.replace(/^Tasks:\n/, "")}`,
    ].join("\n\n"),
    image: ctx.image,
    embargo: ctx.embargo,
  });
  const byId = new Map(o.readers.map((r) => [r.persona_id, r]));
  return panel.flatMap((p) => {
    const r = byId.get(p.id);
    if (!r) return [];
    return [{
      persona_id: p.id,
      persona_name: p.name,
      takeaway: r.takeaway,
      tone: r.tone.map((t) => t.toLowerCase().trim()).filter(Boolean),
      intent_match: r.intent_match,
      beliefs: r.beliefs
        .filter((b) => b.belief.trim())
        .map((b) => ({ ...b, confidence: Math.min(1, Math.max(0, b.confidence)), grounded: false })),
    }];
  });
}
