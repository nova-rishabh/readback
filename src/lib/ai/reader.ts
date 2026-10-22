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
