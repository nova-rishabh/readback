// Impression Engine orchestrator: mask -> vision -> rules -> 6 readers -> ground -> group -> verify -> fix + re-read -> summary.
import { runRules } from "@/lib/rules";
import type { BrandSpace, CheckEvent, CheckSummary, Channel, Finding, Lang, ReaderResult, Span } from "../types";
import { contentHash, LRU } from "./cache";
import { fixAndGate, trimSpan } from "./fix";
import { locateQuote } from "./grounding";
import { clusterBeliefs, selectGroups, type BeliefItem } from "./group";
import { maskAll } from "./mask";
import { panelFor, type ReadCtx } from "./personas";
import { embedTexts, isMock, MODEL_NAME, type Img } from "./provider";
import { readPersona } from "./reader";
import { toneFinding } from "./tone";
import { buildClaimFindings, verifyGroups } from "./verify";
import { confirmVisual, extractTextBoxes, type TextBox } from "./vision";

export interface CheckInput {
  text: string;
  intent: string;
  lang: Lang;
  channel: Channel;
  image?: { data: Buffer; mime: string } | null;
  imageAlt?: string | null;
  lockedPhrases: string[];
  brand: BrandSpace;
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
  const hit = cache.get(key);
  if (hit) {
    hit.events.forEach(emit);
    return hit.result;
  }
  const events: CheckEvent[] = [];
  const out = (e: CheckEvent) => (events.push(e), emit(e));
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

    // 4. readers in parallel (25s timeout + one retry live in callObject), grounding as each one lands
    const panel = panelFor(brand);
    out({ type: "stage", stage: "readers", message: `${panel.length} readers are reading the draft` });
    const ctx: ReadCtx = { text, intent: input.intent, lang: input.lang, channel: input.channel, image, brandName: brand.name, embargo };
    const seen = new Map<string, Promise<boolean>>();
    const confirm = (el: string) => seen.get(el) ?? seen.set(el, image ? confirmVisual(image, el) : Promise.resolve(false)).get(el)!;
    const pending: { reader: ReaderResult; belief: ReaderResult["beliefs"][number]; span: Span | null }[] = [];
    const settled = await Promise.allSettled(
      panel.map(async (p, i) => {
        const r = await readPersona(p, i, ctx);
        for (const b of r.beliefs) {
          const span = locateQuote(text, b.trigger_quote);
          b.grounded = !!span || (!!b.visual_element && (await confirm(b.visual_element)));
          pending.push({ reader: r, belief: b, span });
        }
        out({ type: "reader", result: r });
        return r;
      }),
    );
    const readers = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const of = readers.length;
    if (!of) out({ type: "error", message: "All readers failed; showing rule findings only." });

    // 5. group + 6. verify
    out({ type: "stage", stage: "group", message: "Grouping beliefs held by two or more readers" });
    const items: BeliefItem[] = pending
      .filter((p) => p.belief.grounded && readers.includes(p.reader))
      .map((p) => ({
        reader: p.reader.persona_id, reader_name: p.reader.persona_name, belief: p.belief.belief, category: p.belief.category,
        quote: p.belief.trigger_quote, span: p.span, visual: p.belief.visual_element, embedding: [],
      }));
    let ai: Finding[] = [];
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

    // 7. span fix + re-read gate (one fix call and one batched re-read call per finding)
    const bad = ai.filter((f) => f.belief && (f.belief.verdict === "contradicted" || f.belief.verdict === "unsupported"));
    const flagged = bad.map((f) => f.belief!.statement);
    const targets = ai.filter((f) => fixable.has(f.id) && (f.category === "tone" || bad.includes(f)));
    if (targets.length) out({ type: "stage", stage: "fix", message: `Drafting and re-reading ${targets.length} fix(es)` });
    await Promise.allSettled(
      targets.map(async (f) => {
        const s = await fixAndGate({
          draft: text, span: fixable.get(f.id)!, kind: f.category === "tone" ? "tone" : "claim", belief: f.belief?.statement ?? null,
          reason: f.explanation, intent: input.intent, locked: input.lockedPhrases, brand, panel, image, flagged, embargo,
        });
        if (s) { f.suggestion = s; out({ type: "suggestion", finding_id: f.id, suggestion: s }); }
      }),
    );

    // 8. summary
    const findings = [...ruleFindings, ...ai];
    const summary: CheckSummary = {
      rule_count: ruleFindings.length,
      ai_count: ai.length,
      high: findings.filter((f) => f.severity === "high").length,
      intent_kept: readers.filter((r) => r.intent_match).length,
      of,
      ms_total: Date.now() - t0,
      model: MODEL_NAME,
      mode,
      masked_tokens: masked.count,
    };
    out({ type: "stage", stage: "done", message: "Check complete" });
    out({ type: "summary", summary });
    const result = { findings, summary, readers };
    cache.set(key, { events, result });
    return result;
  } catch (e) {
    out({ type: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
