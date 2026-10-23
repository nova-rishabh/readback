import { embed } from "ai";
import { google } from "@ai-sdk/google";
import { mask } from "@/lib/privacy/gate";

export function embeddingsEnabled(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.READBACK_MOCK_AI !== "1";
}

/**
 * Embed text with gemini-embedding-001 (768 dims). The Privacy Gate runs first, so PII and embargoed names never
 * reach the embedding endpoint. Returns null when no key / mock mode / on failure.
 */
export async function embedText(text: string, embargo: string[] = []): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  try {
    const { masked } = mask(text, embargo);
    const { embedding } = await embed({ model: google.textEmbeddingModel("gemini-embedding-001", { outputDimensionality: 768 }), value: masked });
    return embedding.length === 768 ? embedding : null;
  } catch (e) {
    console.warn("[readback] embedding skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** pgvector text literal, e.g. "[0.1,0.2]" */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
