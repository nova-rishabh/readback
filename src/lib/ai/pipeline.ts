// Impression Engine orchestrator: mask -> vision -> rules -> 6-reader panel -> ground -> group -> verify -> fix + re-read -> summary.
// At most 6 generateContent calls per check (vision, panel, visual confirm, fact judge, fixes, re-read).
import { runRules } from "@/lib/rules";
import type { BrandSpace, CheckEvent, CheckSummary, Channel, Finding, Lang, ReaderResult, Span } from "../types";
import { contentHash, LRU } from "./cache";
import { fixAllAndGate, trimSpan, type FixTarget } from "./fix";
import { locateQuote } from "./grounding";
import { anchorGroups, clusterBeliefs, selectGroups, type BeliefItem } from "./group";
import { maskAll } from "./mask";
import { panelFor, type ReadCtx } from "./personas";
import { embedTexts, isMock, LEXICAL, MODEL_NAME, QuotaError, withTracker, type Img, type Tracker } from "./provider";
import { readPanel } from "./reader";
import { toneFinding } from "./tone";
import { buildClaimFindings, verifyGroups } from "./verify";
import { compareInContext, driftFindings, gateDriftFixes } from "./drift";
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
  // translations: the English master this draft translates; its beliefs are compared with this draft's
  master?: { id: string; number: number; version: number; body: string; lang: Lang } | null;
  // benchmark knobs: skip span fixes, and bypass the content-hash cache so repeated runs measure stability
  options?: { fixes?: boolean; cache?: boolean; apiKey?: string };
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
  const tracker: Tracker = { models: new Set(), calls: 0, deadline: t0 + 100_000, apiKey: input.options?.apiKey }; // keep a check under ~2 min
  let partial = false;
  let partialReason: string | undefined;
  let driftSummary: CheckSummary["drift"];
  return withTracker(tracker, async () => {
  try {
    const { text, brand } = input;
    const image: Img | null = input.image ?? null;
    const embargo = brand.terms.filter((t) => t.kind === "embargo").map((t) => t.phrase);

    // 1. mask: nothing leaves this process unmasked (callObject/embedTexts mask again at the network edge)
    const masked = maskAll([text, input.intent, input.imageAlt ?? "", ...input.lockedPhrases], embargo);
    out({ type: "stage", stage: "mask", message: `Masked ${masked.count} private or embargoed item(s) before any model call` });

    // 2. rule engine on text immediately, then 3. again with image text boxes once vision answers (contrast needs them)
    out({ type: "stage", stage: "rules", message: "Running rule engine" });
    const tr = Date.now();
    const rules = async (textBoxes: TextBox[]) => {
      try {
        return await runRules({ text, image: image?.data ?? null, imageAlt: input.imageAlt ?? null, textBoxes, brand, channel: input.channel });
      } catch (e) {
        out({ type: "error", message: `Rule engine failed: ${e instanceof Error ? e.message : String(e)}` });
        return [];
      }
    };
    let ruleFindings: Finding[] = await rules([]);
    const ruleMs = Date.now() - tr; // the rule engine's own time; the vision wait below is not counted
    out({ type: "rules", findings: ruleFindings, ms: ruleMs });
    if (image) {
      const textBoxes: TextBox[] = await extractTextBoxes(image);
      if (textBoxes.length) {
        ruleFindings = await rules(textBoxes);
        out({ type: "rules", findings: ruleFindings, ms: ruleMs });
      }
    }

    // 4. the six-reader panel: ONE batched call (free-tier Gemini allows 5 requests/min per model)
    const panel = panelFor(brand, input.lang);
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
        // one embedding per anchored group (same category, same quoted words), shared by its members
        const anchored = anchorGroups(items);
        const embs = await embedTexts(anchored.map((g) => items[g[0]].belief), embargo);
        anchored.forEach((g, gi) => g.forEach((i) => (items[i].embedding = embs[gi])));
        // word-overlap vectors (embedding quota used up) score paraphrases lower, so they get lower thresholds
        const lexical = tracker.embedModel === LEXICAL;
        const groups = selectGroups(lexical ? clusterBeliefs(items, 0.55, 0.2) : clusterBeliefs(items), of);
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
      // label AI findings with the model(s) that actually answered (rotation may have moved off the primary)
      const answered = [...tracker.models].join("+");
      if (answered) for (const f of ai) f.model = answered;
      out({ type: "findings", findings: ai });

      // 6b. translations: compare with the English master (one call) and gate any suggested wording (one more)
      if (input.master) {
        out({ type: "stage", stage: "drift", message: `Comparing with the English master #${input.master.number}` });
        const m = input.master;
        try {
          const res = await compareInContext({ master: m.body, variant: text, variantLang: input.lang, brand });
          const answeredBy = [...tracker.models].join("+") || MODEL_NAME;
          const drift = driftFindings(res, text, m.number, input.lang, answeredBy);
          for (const f of drift) {
            const s = f.span && trimSpan(text, f.span, input.lockedPhrases);
            if (f.span && !s) f.suggestion = null; // the words are locked: flag, but never rewrite them
            else if (s) f.span = s;
          }
          if (input.options?.fixes !== false) {
            await gateDriftFixes(drift, { master: m.body, variant: text, variantLang: input.lang, brand }).catch(() => undefined);
          }
          ai.push(...drift);
          driftSummary = { master_id: m.id, master_number: m.number, master_version: m.version, master_lang: m.lang, master_body: m.body, rows: res.rows, of: res.of };
        } catch (e) {
          const why = e instanceof QuotaError ? "Gemini was at its limit" : "the comparison call failed";
          driftSummary = { master_id: m.id, master_number: m.number, master_version: m.version, master_lang: m.lang, master_body: m.body, rows: [], of: panel.length, failed: why };
          out({ type: "stage", stage: "drift", message: `Could not compare with the master (${why}). Run the check again.` });
        }
        out({ type: "findings", findings: ai });
      }

      // 7. span fixes (one call) + one combined re-read gate
      const bad = ai.filter((f) => f.category !== "language_drift" && f.belief && (f.belief.verdict === "contradicted" || f.belief.verdict === "unsupported"));
      const flagged = bad.map((f) => f.belief!.statement);
      const targets: FixTarget[] = ai
        .filter((f) => fixable.has(f.id) && (f.category === "tone" || bad.includes(f)))
        .map((f) => ({ id: f.id, span: fixable.get(f.id)!, kind: f.category === "tone" ? "tone" : "claim", belief: f.belief?.statement ?? null, reason: f.explanation }));
      // fixes are the last, optional stage: skip them when the check is already long so results get saved in time
      const late = Date.now() - t0 > 150_000;
      if (late && targets.length) out({ type: "stage", stage: "fix", message: "Skipped fixes: the check ran long. Run it again for suggestions." });
      if (targets.length && input.options?.fixes !== false && !late) {
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
      const raw = e instanceof Error ? e.message : "";
      // say what actually happened: a long wait means a daily limit, not the per-minute one
      partialReason = !(e instanceof QuotaError)
        ? /quota|rate.?limit|429/i.test(raw)
          ? "the free Gemini key reached its daily limit"
          : `the AI call failed (${raw.slice(0, 100) || "unknown error"})`
        : e.reason === "overloaded"
          ? "Gemini was overloaded (HTTP 503 on every model)"
          : e.retryAfterSeconds > 600
            ? "the free Gemini key reached its daily limit on every model"
            : `the free Gemini key reached its per-minute limit (retry in ${e.retryAfterSeconds}s)`;
      out({ type: "error", message: `The AI readers did not finish: ${partialReason}. Rule findings are saved; run the check again later, or add your own Gemini key from the top bar.` });
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
      partial: partial || readers.length === 0 || undefined,
      partial_reason: partialReason ?? (readers.length === 0 ? "no reader answered" : undefined),
      own_key: !!input.options?.apiKey || undefined,
      readers: readers.length ? readers : undefined,
      drift: driftSummary,
      embeddings: tracker.factsByWords ? `${tracker.embedModel ?? "lexical"}, facts by word overlap` : tracker.embedModel,
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
