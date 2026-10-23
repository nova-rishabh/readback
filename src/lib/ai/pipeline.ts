// Impression Engine orchestrator: mask -> vision -> rules -> 6-reader panel -> ground -> group -> verify -> fix + re-read -> summary.
// At most 6 generateContent calls per check (vision, panel, visual confirm, fact judge, fixes, re-read).
import { runRules } from "@/lib/rules";
import type { BrandSpace, CheckEvent, CheckSummary, Channel, Finding, Lang, ReaderResult, Span } from "../types";
import { contentHash, LRU } from "./cache";
import { fixAllAndGate, trimSpan, type FixTarget } from "./fix";
import { locateQuote } from "./grounding";
import { clusterBeliefs, selectGroups, type BeliefItem } from "./group";
import { maskAll } from "./mask";
import { panelFor, type ReadCtx } from "./personas";
import { embedTexts, isMock, MODEL_NAME, QuotaError, withTracker, type Img, type Tracker } from "./provider";
import { readPanel } from "./reader";
import { toneFinding } from "./tone";
import { buildClaimFindings, verifyGroups } from "./verify";
import { confirmVisuals, extractTextBoxes, type TextBox } from "./vision";

export interface CheckInput {
  text: string;
  intent: string;
  lang: Lang;
  channel: Channel;
  image?: { data: Buffer; mime: string } | null;
  imageAlt?: string | null;
  lockedPhrases: string[];
  brand: BrandSpace;
  // benchmark knobs: skip span fixes, and bypass the content-hash cache so repeated runs measure stability
  options?: { fixes?: boolean; cache?: boolean };
}
export interface CheckResult {
  findings: Finding[];
  summary: CheckSummary;
  readers: ReaderResult[];
}

const cache = new LRU<{ events: CheckEvent[]; result: CheckResult }>(50);

export async function runCheck(input: CheckInput, emit: (e: CheckEvent) => void): Promise<CheckResult> {
  const t0 = Date.now();
  const mode = isMock() ? "mock" : "cloud";
  const key = contentHash({ ...input, mode });
  const useCache = input.options?.cache !== false;
  const hit = useCache ? cache.get(key) : undefined;
  if (hit) {
    hit.events.forEach(emit);
    return hit.result;
  }
  const events: CheckEvent[] = [];
  const out = (e: CheckEvent) => (events.push(e), emit(e));
  const tracker: Tracker = { models: new Set(), calls: 0, deadline: t0 + 100_000 }; // keep a check under ~2 min
  let partial = false;
  return withTracker(tracker, async () => {
  try {
    const { text, brand } = input;
    const image: Img | null = input.image ?? null;
    const embargo = brand.terms.filter((t) => t.kind === "embargo").map((t) => t.phrase);

    // 1. mask: nothing leaves this process unmasked (callObject/embedTexts mask again at the network edge)
    const masked = maskAll([text, input.intent, input.imageAlt ?? "", ...input.lockedPhrases], embargo);
    out({ type: "stage", stage: "mask", message: `Masked ${masked.count} private or embargoed item(s) before any model call` });

    // 2. vision text boxes + 3. rule engine
    out({ type: "stage", stage: "rules", message: "Running rule engine" });
    const tr = Date.now();
    const textBoxes: TextBox[] = image ? await extractTextBoxes(image) : [];
    let ruleFindings: Finding[] = [];
    try {
      ruleFindings = await runRules({ text, image: image?.data ?? null, imageAlt: input.imageAlt ?? null, textBoxes, brand, channel: input.channel });
    } catch (e) {
      out({ type: "error", message: `Rule engine failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    out({ type: "rules", findings: ruleFindings, ms: Date.now() - tr });

    // 4. the six-reader panel: ONE batched call (free-tier Gemini allows 5 requests/min per model)
    const panel = panelFor(brand);
    out({ type: "stage", stage: "readers", message: `${panel.length} readers are reading the draft` });
    const ctx: ReadCtx = { text, intent: input.intent, lang: input.lang, channel: input.channel, image, brandName: brand.name, embargo };
    let readers: ReaderResult[] = [];
    let ai: Finding[] = [];
    try {
      readers = await readPanel(panel, ctx);
      // grounding guard: quotes must exist in the draft; visual-only beliefs are confirmed in one batched vision call
      const located = new Map<ReaderResult["beliefs"][number], Span | null>();
      for (const r of readers) for (const b of r.beliefs) located.set(b, locateQuote(text, b.trigger_quote));
      const visuals = [...new Set([...located].filter(([b, s]) => !s && b.visual_element).map(([b]) => b.visual_element!))];
      const seenInImage = image ? await confirmVisuals(image, visuals) : new Set<string>();
      for (const [b, s] of located) b.grounded = !!s || (!!b.visual_element && seenInImage.has(b.visual_element));
      for (const r of readers) {
        out({ type: "reader", result: r });
        await new Promise((res) => setTimeout(res, isMock() ? 0 : 150)); // let the panel fill in visibly
      }
      const of = readers.length;
      if (!of) out({ type: "error", message: "No reader answered; showing rule findings only." });

      // 5. group + 6. verify
      out({ type: "stage", stage: "group", message: "Grouping beliefs held by two or more readers" });
      const items: BeliefItem[] = readers.flatMap((r) =>
        r.beliefs
          .filter((b) => b.grounded)
          .map((b) => ({
            reader: r.persona_id, reader_name: r.persona_name, belief: b.belief, category: b.category,
            quote: b.trigger_quote, span: located.get(b) ?? null, visual: b.visual_element, embedding: [] as number[],
          })),
      );
      if (items.length) {
        const embs = await embedTexts(items.map((i) => i.belief), embargo);
        items.forEach((it, i) => (it.embedding = embs[i]));
        const groups = selectGroups(clusterBeliefs(items), of);
        out({ type: "stage", stage: "verify", message: `Checking ${groups.length} shared belief(s) against the Fact Ledger` });
        ai = buildClaimFindings(groups, await verifyGroups(groups, brand, embargo), of, brand, MODEL_NAME);
      }
      const tone = toneFinding(readers, brand, text, MODEL_NAME);
      if (tone) ai.push(tone);
      // never edit a locked phrase: trim spans, and skip the fix when nothing editable is left
      const fixable = new Map<string, Span>();
      for (const f of ai) {
        const s = f.span && trimSpan(text, f.span, input.lockedPhrases);
        if (s) { f.span = s; fixable.set(f.id, s); }
      }
      out({ type: "findings", findings: ai });

      // 7. span fixes (one call) + one combined re-read gate
      const bad = ai.filter((f) => f.belief && (f.belief.verdict === "contradicted" || f.belief.verdict === "unsupported"));
      const flagged = bad.map((f) => f.belief!.statement);
      const targets: FixTarget[] = ai
        .filter((f) => fixable.has(f.id) && (f.category === "tone" || bad.includes(f)))
        .map((f) => ({ id: f.id, span: fixable.get(f.id)!, kind: f.category === "tone" ? "tone" : "claim", belief: f.belief?.statement ?? null, reason: f.explanation }));
      if (targets.length && input.options?.fixes !== false) {
        out({ type: "stage", stage: "fix", message: `Drafting ${targets.length} fix(es) and re-reading the corrected draft` });
        const sugs = await fixAllAndGate(targets, { draft: text, intent: input.intent, locked: input.lockedPhrases, brand, panel, image, flagged, embargo });
        for (const f of ai) {
          const sg = sugs.get(f.id);
          if (sg) { f.suggestion = sg; out({ type: "suggestion", finding_id: f.id, suggestion: sg }); }
        }
      }
    } catch (e) {
      // any AI-stage failure keeps the rule findings: they are saved and the reason is shown
      partial = true;
      out({
        type: "error",
        message: !(e instanceof QuotaError)
          ? `The AI check stopped (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}). Rule findings are saved; run the check again.`
          : e.reason === "quota"
            ? `Gemini free-tier limit reached (5 requests per minute per model). Rule findings are saved; run the AI check again in ${e.retryAfterSeconds}s.`
            : `Gemini is overloaded right now (HTTP 503 on every model). Rule findings are saved; run the AI check again in a minute.`,
      });
    }
    const of = readers.length;

    // 8. summary
    const findings = [...ruleFindings, ...ai];
    const summary: CheckSummary = {
      rule_count: ruleFindings.length,
      ai_count: ai.length,
      high: findings.filter((f) => f.severity === "high").length,
      intent_kept: readers.filter((r) => r.intent_match).length,
      of,
      ms_total: Date.now() - t0,
      model: [...tracker.models].join("+") || MODEL_NAME,
      mode,
      masked_tokens: masked.count,
    };
    out({ type: "stage", stage: "done", message: "Check complete" });
    out({ type: "summary", summary });
    const result = { findings, summary, readers };
    if (!partial && useCache) cache.set(key, { events, result });
    return result;
  } catch (e) {
    out({ type: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  });
}
