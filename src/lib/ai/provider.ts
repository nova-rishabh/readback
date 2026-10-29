// Gemini access: quota-aware model rotation (module-scope cooldowns), mock flag, and the two guarded entry
// points to the network: callObject (masked structured generation) and embedTexts (embedMany).
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { embedMany, generateObject } from "ai";
import type { z } from "zod";
import { maskAll, unmaskDeep } from "./mask";
import { mockEmbed } from "./mock";

const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
export const MODELS: string[] = process.env.GEMINI_MODELS
  ? process.env.GEMINI_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
  : [...new Set([process.env.GEMINI_MODEL, ...DEFAULT_MODELS].filter((m): m is string => !!m))];
export const MODEL_NAME = MODELS[0];
export const EMBED_MODEL = "gemini-embedding-001"; // truncated to 768 dims to match facts.embedding
// Free-tier embeddings allow 1,000 requests per model per day. When the primary is used up, a check moves to the next
// model (and matches facts in memory, since stored fact vectors are in the primary's space), and as a last resort
// to word-overlap vectors, so a check never loses its reader findings to an embedding quota.
export const EMBED_MODELS: string[] = process.env.READBACK_EMBED_MODELS
  ? process.env.READBACK_EMBED_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
  : [EMBED_MODEL, "gemini-embedding-2", "gemini-embedding-2-preview"];
export const LEXICAL = "lexical";
export const TIMEOUT_MS = 40_000;
export const isMock = () =>
  process.env.READBACK_MOCK_AI === "1" || (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !als.getStore()?.apiKey);

export interface Img {
  data: Buffer;
  mime: string;
}

/** Thrown when every model in the rotation is cooling down after a 429. */
export class QuotaError extends Error {
  constructor(
    public retryAfterSeconds: number,
    public reason: "quota" | "overloaded" = "quota",
  ) {
    super(`Gemini ${reason === "quota" ? "quota exhausted" : "overloaded"} on all models; retry in ${retryAfterSeconds}s`);
    this.name = "QuotaError";
  }
}

// ---- per-check tracking (which models answered, how many calls) ----
export interface Tracker {
  models: Set<string>;
  calls: number;
  deadline?: number; // epoch ms; past it, calls stop waiting out cooldowns
  apiKey?: string; // a viewer's own Gemini key for this request only; never stored or logged
  embedModel?: string; // the embedding space this check uses; fixed by its first embedding call
  factsByWords?: boolean; // the embedding model ran out partway: facts were matched by shared words
}
const als = new AsyncLocalStorage<Tracker>();

// ---- whose key: the shared server key, or a viewer's own key passed with the request ----
const clients = new Map<string, ReturnType<typeof createGoogleGenerativeAI>>();
function provider() {
  const key = als.getStore()?.apiKey;
  if (!key) return google;
  const id = scope();
  if (!clients.has(id)) clients.set(id, createGoogleGenerativeAI({ apiKey: key }));
  return clients.get(id)!;
}
/** Quota state is per key: a viewer's key and the shared key have separate limits. Only a hash prefix is kept. */
function scope(): string {
  const key = als.getStore()?.apiKey;
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "shared";
}
export const usingOwnKey = () => !!als.getStore()?.apiKey;
export const withTracker = <T>(t: Tracker, fn: () => Promise<T>) => als.run(t, fn);

// ---- rotation state: lives in module scope so it survives across requests on a warm server ----
const cooldown = new Map<string, number>(); // model -> epoch ms when usable again
const quotaHit = new Set<string>(); // models whose cooldown came from a 429 rather than a 503
let rr = 0;

const statusOf = (e: unknown) => (e as { statusCode?: number })?.statusCode ?? 0;
export function retrySeconds(e: unknown): number {
  const raw = `${(e as Error)?.message ?? ""} ${(e as { responseBody?: string })?.responseBody ?? ""}`;
  // "retry in 41.5s", "retry in 22h12m17.9s" (daily quota), or a JSON retryDelay
  const hms = raw.match(/retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
  if (hms) return Math.ceil(Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + parseFloat(hms[3]));
  const m = raw.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  return m ? Math.ceil(parseFloat(m[1])) : 60;
}

const k = (model: string) => `${scope()}|${model}`;

function available(): string[] {
  const now = Date.now();
  const live = MODELS.filter((m) => (cooldown.get(k(m)) ?? 0) <= now);
  if (!live.length) {
    const soonest = Math.min(...MODELS.map((m) => cooldown.get(k(m)) ?? 0));
    const reason = MODELS.some((m) => quotaHit.has(k(m))) ? "quota" : "overloaded";
    throw new QuotaError(Math.max(1, Math.ceil((soonest - now) / 1000)), reason);
  }
  const start = rr++ % live.length; // spread load: each call starts one model further along
  return [...live.slice(start), ...live.slice(0, start)];
}

export function resetQuotaState() {
  cooldown.clear();
  quotaHit.clear();
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
  const track = als.getStore();
  let retried = false;
  let waited = 0;
  for (;;) {
    let models: string[];
    try {
      models = available();
    } catch (e) {
      // short cooldowns (503 spikes, per-minute quota) are worth waiting out once the rotation is exhausted
      if (!(e instanceof QuotaError)) throw e;
      const late = track?.deadline !== undefined && Date.now() + e.retryAfterSeconds * 1000 > track.deadline;
      if (e.retryAfterSeconds > 20 || waited >= 45 || late) throw e;
      await new Promise((r) => setTimeout(r, e.retryAfterSeconds * 1000));
      waited += e.retryAfterSeconds;
      continue;
    }
    for (const model of models) {
      try {
        const t = Date.now();
        const { object } = await generateObject({
          model: provider()(model),
          schema: o.schema,
          system: out[0],
          messages: [{ role: "user", content }],
          temperature: o.temperature ?? 0.2,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (track) (track.calls++, track.models.add(model));
        quotaHit.delete(k(model));
        if (process.env.READBACK_DEBUG) console.error(`[gemini] ${model} ok ${Date.now() - t}ms`);
        return unmaskDeep(object, tokens);
      } catch (e) {
        if (process.env.READBACK_DEBUG) console.error(`[gemini] ${model} fail ${statusOf(e)} ${(e as Error).message?.slice(0, 120)}`);
        const timedOut = (e as Error)?.name === "TimeoutError" || /aborted due to timeout/i.test((e as Error)?.message ?? "");
        const s = timedOut ? 503 : statusOf(e); // a hung model is treated like an overloaded one: rotate
        if (s === 429) {
          cooldown.set(k(model), Date.now() + retrySeconds(e) * 1000);
          quotaHit.add(k(model));
        } else if (s === 503) cooldown.set(k(model), Date.now() + 15_000);
        else if (s === 404) cooldown.set(k(model), Date.now() + 3_600_000);
        else {
          if (retried) throw e;
          retried = true; // invalid output or timeout: one more pass
        }
        if (![429, 503, 404].includes(s)) break;
      }
    }
  }
}

/** Word-overlap vectors: a deterministic stand-in when every embedding model is out of quota (or in mock mode). */
export { mockEmbed as lexicalEmbed } from "./mock";

/** Record that facts were matched by shared words because embeddings ran out partway through the check. */
export const markFactsByWords = () => {
  const t = als.getStore();
  if (t) t.factsByWords = true;
};

/** Which embedding space the current check is in: a model name, "lexical", or undefined before the first call. */
export const embedSpace = () => als.getStore()?.embedModel;

export async function embedTexts(texts: string[], embargo: string[] = []): Promise<number[][]> {
  if (!texts.length) return [];
  if (isMock()) return texts.map(mockEmbed);
  const track = als.getStore();
  if (track?.embedModel === LEXICAL) return texts.map(mockEmbed);
  const { out } = maskAll(texts, embargo);
  // one check stays in one vector space: once a model has answered, later calls in the check use it too
  const order = track?.embedModel ? [track.embedModel] : EMBED_MODELS;
  let err: unknown;
  for (const model of order) {
    if ((cooldown.get(k(`embed:${model}`)) ?? 0) > Date.now()) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { embeddings } = await embedMany({
          model: provider().textEmbeddingModel(model, { outputDimensionality: 768 }),
          values: out,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (track) track.embedModel = model;
        return embeddings;
      } catch (e) {
        err = e;
        if (statusOf(e) === 429) {
          cooldown.set(k(`embed:${model}`), Date.now() + retrySeconds(e) * 1000);
          break; // try the next model
        }
      }
    }
  }
  // nothing answered: every model is out of quota or cooling down (err stays undefined when all were skipped)
  if (track && !track.embedModel && (err === undefined || statusOf(err) === 429)) {
    track.embedModel = LEXICAL;
    return texts.map(mockEmbed);
  }
  throw err ?? new QuotaError(60, "quota");
}
