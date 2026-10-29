// Live Fact Recall, the workflow half. The recall queue is computed, never stored: approved or published posts whose
// cited fact is now expired, retired or on a newer version. Live-page checks and closures are audit-log entries
// (insert-only, hash-chained), so the queue's state is derived from the same tamper-evident record reviewers trust.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fact, Finding, Role, Submission } from "../types";
import { mapFact, mapSubmission, todayISO, type Row } from "../db/mappers";
import { writeAudit } from "../db/queries";
import { createAdmin } from "../db/server";
import { embedText, toVectorLiteral } from "../db/embed";
import { checkLive, claimPhrases, type LiveCheck, type LiveOutcome } from "./live";

const SUBMISSION_SELECT = "*, author:profiles!submissions_author_id_fkey(name, role)";
export const SCHEDULER = { id: null, name: "Readback scheduler", role: "system" as const };

export interface RecallItem {
  submission: Submission;
  fact: Fact;
  fact_code: string;
  reason: string;
  url: string | null;
  phrases: string[]; // the approved wording that relied on the fact, looked for on the live page
  last_check: { at: string; outcome: LiveOutcome; matched: string[]; error: string | null; by: string } | null;
  closed: { at: string; by: string; auto: boolean; note: string | null } | null;
}

export interface ExpiryAlert {
  fact: Fact;
  days: number; // days until expiry (0 = today)
  posts: Submission[]; // approved or published posts that cite it
}

export interface RecallState {
  open: RecallItem[];
  closed: RecallItem[];
  expiring: ExpiryAlert[];
}

type Actor = { id: string | null; name: string; role: Role | "system" };

/** Same fact, same version, same status: a closure or a check is about exactly this recall, not an older one. */
const sameRecall = (d: Record<string, unknown>, f: Fact) =>
  d.fact_code === f.code && Number(d.fact_version) === f.version && (d.fact_status ?? "active") === f.status;

export async function recallState(sb: SupabaseClient, brandId: string, alertDays = 30): Promise<RecallState> {
  const [cites, facts] = await Promise.all([
    sb.from("fact_citations")
      .select(`fact_code, fact_version, submission:submissions!inner(${SUBMISSION_SELECT})`)
      .eq("submission.brand_id", brandId)
      .in("submission.status", ["approved", "published"]),
    sb.from("facts").select("id, code, statement, source, owner, expires_on, version, status").eq("brand_id", brandId),
  ]);
  if (cites.error) throw new Error(`recall citations: ${cites.error.message}`);
  if (facts.error) throw new Error(`recall facts: ${facts.error.message}`);
  const byCode = new Map<string, Fact>((facts.data as Row[]).map((r) => [r.code as string, mapFact(r)]));

  const raw: { submission: Submission; fact: Fact; reason: string }[] = [];
  const citing = new Map<string, Submission[]>();
  for (const c of cites.data as Row[]) {
    const fact = byCode.get(c.fact_code);
    if (!fact) continue;
    const submission = mapSubmission(c.submission);
    citing.set(fact.code, [...(citing.get(fact.code) ?? []), submission]);
    let reason: string | null = null;
    if (fact.status === "expired") reason = `${fact.code} expired${fact.expires_on ? ` on ${fact.expires_on}` : ""}: "${fact.statement}"`;
    else if (fact.status === "retired") reason = `${fact.code} was retired`;
    else if (fact.version > c.fact_version) reason = `${fact.code} changed from v${c.fact_version} to v${fact.version}: "${fact.statement}"`;
    if (reason) raw.push({ submission, fact, reason });
  }

  const ids = [...new Set(raw.map((r) => r.submission.id))];
  const [versions, audit] = ids.length
    ? await Promise.all([
        sb.from("versions").select("submission_id, n, body, findings").in("submission_id", ids),
        sb.from("audit_log").select("id, submission_id, actor_name, action, detail, created_at")
          .in("submission_id", ids).in("action", ["recall_url_checked", "recall_closed"]).order("id", { ascending: false }),
      ])
    : [{ data: [] as Row[] }, { data: [] as Row[] }];
  const latest = new Map<string, { n: number; body: string; findings: Finding[] }>();
  for (const v of (versions.data ?? []) as Row[]) {
    const cur = latest.get(v.submission_id);
    if (!cur || v.n > cur.n) latest.set(v.submission_id, { n: v.n, body: v.body, findings: v.findings ?? [] });
  }
  // checks and closures recorded before the last demo reset belong to the old demo state
  const { data: reset } = await sb.from("audit_log").select("id").eq("action", "demo_reset").order("id", { ascending: false }).limit(1).maybeSingle();
  const events = ((audit.data ?? []) as Row[]).filter((e) => !reset || Number(e.id) > Number(reset.id));

  const items: RecallItem[] = raw.map(({ submission, fact, reason }) => {
    const v = latest.get(submission.id);
    const mine = events.filter((e) => e.submission_id === submission.id && sameRecall(e.detail ?? {}, fact));
    const check = mine.find((e) => e.action === "recall_url_checked");
    const close = mine.find((e) => e.action === "recall_closed");
    return {
      submission, fact, fact_code: fact.code, reason, url: submission.published_url,
      phrases: v ? claimPhrases(v.findings, fact.code, v.body, fact.statement) : [],
      last_check: check
        ? { at: check.created_at, outcome: check.detail.outcome, matched: check.detail.matched ?? [], error: check.detail.error ?? null, by: check.actor_name }
        : null,
      closed: close ? { at: close.created_at, by: close.actor_name, auto: !!close.detail.auto, note: close.detail.note ?? null } : null,
    };
  });
  const order = (a: RecallItem, b: RecallItem) => b.submission.number - a.submission.number || a.fact_code.localeCompare(b.fact_code);

  const today = todayISO();
  const soon = new Date(Date.now() + alertDays * 864e5).toISOString().slice(0, 10);
  const expiring: ExpiryAlert[] = [...byCode.values()]
    .filter((f) => f.status === "active" && f.expires_on && f.expires_on >= today && f.expires_on <= soon)
    .map((f) => ({
      fact: f,
      days: Math.round((Date.parse(f.expires_on!) - Date.parse(today)) / 864e5),
      posts: (citing.get(f.code) ?? []).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
    }))
    .sort((a, b) => a.days - b.days);

  return { open: items.filter((i) => !i.closed).sort(order), closed: items.filter((i) => i.closed).sort(order), expiring };
}

const auditDetail = (item: RecallItem) => ({ fact_code: item.fact.code, fact_version: item.fact.version, fact_status: item.fact.status });

/**
 * Fetch the live URL, look for the approved wording that relied on the fact, and record the result. When the
 * wording is gone, the recall closes itself with its own audit entry.
 */
export async function runLiveCheck(item: RecallItem, actor: Actor): Promise<LiveCheck> {
  if (!item.url) throw new Error("No live URL is recorded for this post");
  const res = await checkLive(item.url, item.phrases);
  await writeAudit(actor, {
    submission_id: item.submission.id, action: "recall_url_checked", fact_versions: { [item.fact.code]: item.fact.version },
    detail: { ...auditDetail(item), url: item.url, outcome: res.outcome, http: res.http, matched: res.matched, looked_for: res.looked_for, error: res.error ?? null },
  });
  if (res.outcome === "removed") {
    await writeAudit(actor, {
      submission_id: item.submission.id, action: "recall_closed", fact_versions: { [item.fact.code]: item.fact.version },
      detail: { ...auditDetail(item), auto: true, note: "The stale claim is no longer on the live page." },
    });
  }
  return res;
}

export async function closeRecall(item: RecallItem, actor: Actor, note: string): Promise<void> {
  await writeAudit(actor, {
    submission_id: item.submission.id, action: "recall_closed", fact_versions: { [item.fact.code]: item.fact.version },
    detail: { ...auditDetail(item), auto: false, note },
  });
}

/** After a fact edit: check the live page of every open recall that cites it (service client, no request needed). */
export async function recheckFact(brandId: string, factCode: string, actor: Actor): Promise<number> {
  const state = await recallState(createAdmin(), brandId);
  const todo = state.open.filter((i) => i.fact_code === factCode && i.url);
  for (const item of todo) await runLiveCheck(item, actor).catch(() => undefined);
  return todo.length;
}

/**
 * The daily job (Vercel Cron, /api/cron/recall): reset the shared demo drafts, mark facts past their expiry date as expired, raise a one-time
 * alert for facts expiring within 14 days, and re-check every open recall's live page not checked in the last 20 hours.
 */
export async function dailySweep(opts: { budgetMs?: number; resetOrigin?: string } = {}): Promise<Record<string, number>> {
  const budgetMs = opts.budgetMs ?? 50_000;
  const t0 = Date.now();
  const admin = createAdmin();
  const out = { brands: 0, expired: 0, alerts: 0, checked: 0, closed: 0, reset: 0, embedded: 0 };
  // at most once a day, however often the endpoint is called
  const { data: lastReset } = await admin.from("audit_log").select("created_at").eq("action", "demo_reset").order("id", { ascending: false }).limit(1).maybeSingle();
  if (opts.resetOrigin && (!lastReset || Date.now() - Date.parse(lastReset.created_at) > 20 * 3600_000)) {
    const { resetDemo } = await import("../demo/reset");
    await resetDemo(opts.resetOrigin, SCHEDULER).then(() => (out.reset = 1)).catch(() => undefined);
  }
  const { data: brands } = await admin.from("brands").select("id");
  for (const b of brands ?? []) {
    out.brands++;
    const today = todayISO();
    const { data: lapsed } = await admin.from("facts").select("code, version, expires_on")
      .eq("brand_id", b.id).eq("status", "active").lt("expires_on", today);
    for (const f of lapsed ?? []) {
      const { error } = await admin.from("facts").update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("brand_id", b.id).eq("code", f.code).eq("status", "active");
      if (error) continue;
      out.expired++;
      await writeAudit(SCHEDULER, { action: "fact_expired", fact_versions: { [f.code]: f.version }, detail: { code: f.code, expires_on: f.expires_on } });
    }

    // facts edited in the last day (or never embedded) get a fresh vector; a no-op when embeddings are unavailable
    const since = new Date(Date.now() - 26 * 3600_000).toISOString();
    const { data: stale } = await admin.from("facts").select("code, statement").eq("brand_id", b.id).or(`embedding.is.null,updated_at.gte.${since}`);
    const { data: emb } = await admin.from("terms").select("phrase").eq("brand_id", b.id).eq("kind", "embargo");
    for (const f of stale ?? []) {
      const v = await embedText(f.statement, (emb ?? []).map((t: { phrase: string }) => t.phrase));
      if (!v) break;
      await admin.from("facts").update({ embedding: toVectorLiteral(v) }).eq("brand_id", b.id).eq("code", f.code);
      out.embedded++;
    }

    const state = await recallState(admin, b.id, 14);
    const codes = state.expiring.map((a) => a.fact.code);
    const { data: sent } = codes.length
      ? await admin.from("audit_log").select("detail").eq("action", "fact_expiry_alert").in("detail->>code", codes)
      : { data: [] as Row[] };
    for (const a of state.expiring) {
      if ((sent ?? []).some((r: Row) => r.detail?.code === a.fact.code && r.detail?.expires_on === a.fact.expires_on)) continue;
      out.alerts++;
      await writeAudit(SCHEDULER, {
        action: "fact_expiry_alert", fact_versions: { [a.fact.code]: a.fact.version },
        detail: { code: a.fact.code, expires_on: a.fact.expires_on, days: a.days, posts: a.posts.map((p) => p.number) },
      });
    }

    for (const item of state.open) {
      if (Date.now() - t0 > budgetMs) break;
      if (!item.url || (item.last_check && Date.now() - Date.parse(item.last_check.at) < 20 * 3600_000)) continue;
      const r = await runLiveCheck(item, SCHEDULER).catch(() => null);
      if (!r) continue;
      out.checked++;
      if (r.outcome === "removed") out.closed++;
    }
  }
  return out;
}
