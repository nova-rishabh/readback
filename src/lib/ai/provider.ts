// Gemini model handles, mock-mode flag, and the two guarded entry points to the network:
// callObject (masked structured generation, 25s timeout, one retry) and embedTexts.
import { google } from "@ai-sdk/google";
import { embedMany, generateObject } from "ai";
import type { z } from "zod";
import { maskAll, unmaskDeep } from "./mask";
import { mockEmbed } from "./mock";

export const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const EMBED_MODEL = "text-embedding-004";
export const TIMEOUT_MS = 25_000;
export const isMock = () => process.env.READBACK_MOCK_AI === "1" || !process.env.GOOGLE_GENERATIVE_AI_API_KEY;

export interface Img {
  data: Buffer;
  mime: string;
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let err: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Every prompt is masked before it leaves; the structured result is unmasked on the way back. */
export async function callObject<T>(o: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  image?: Img | null;
  embargo?: string[];
  temperature?: number;
}): Promise<T> {
  const { out, tokens } = maskAll([o.system, o.prompt], o.embargo ?? []);
  const content = [
    { type: "text" as const, text: out[1] },
    ...(o.image ? [{ type: "image" as const, image: o.image.data, mimeType: o.image.mime }] : []),
  ];
  return withRetry(async () => {
    const { object } = await generateObject({
      model: google(MODEL_NAME),
      schema: o.schema,
      system: out[0],
      messages: [{ role: "user", content }],
      temperature: o.temperature ?? 0.2,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return unmaskDeep(object, tokens);
  });
}

export async function embedTexts(texts: string[], embargo: string[] = []): Promise<number[][]> {
  if (!texts.length) return [];
  if (isMock()) return texts.map(mockEmbed);
  const { out } = maskAll(texts, embargo);
  const { embeddings } = await withRetry(() =>
    embedMany({
      model: google.textEmbeddingModel(EMBED_MODEL),
      values: out,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  return embeddings;
}
