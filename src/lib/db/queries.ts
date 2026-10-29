// Server-side data access. All reads/writes run as the signed-in user (RLS) except audit writes,
// which go through the service-role client in the single `writeAudit` helper below.
import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import type {
  AuditEntry, BrandSpace, Channel, CheckSummary, Clause, Comment, Fact, Finding, Lang, LinkedSubmission,
  PaletteColor, Persona, Role, Span, Submission, SubmissionStatus, Term, TermKind, Version,
} from "../types";
import { createAdmin, createClient } from "./server";
import { embedText, toVectorLiteral } from "./embed";
import {
  mapAudit, mapClause, mapComment, mapFact, mapPalette, mapPersona, mapSubmission, mapTerm,
  mapVersion, todayISO, type Row,
} from "./mappers";

/** Seeded demo accounts (password = DEMO_PASSWORD). */
export const DEMO_EMAILS: Record<Role, string> = {
  owner: "owner@velura.demo",
  creator: "creator@velura.demo",
  reviewer: "reviewer@velura.demo",
  agency: "agency@bloomagency.demo",
};

const SUBMISSION_SELECT = "*, author:profiles!submissions_author_id_fkey(name, role)";
const COMMENT_SELECT = "*, author:profiles!comments_author_id_fkey(name, role)";

// ------------------------------------------------------------------ internals

export interface Actor { id: string; name: string; role: Role; email: string; brand_id: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

export const getActor = cache(async (): Promise<Actor | null> => {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await sb.from("profiles").select("name, role, brand_id").eq("id", data.user.id).maybeSingle();
  if (!p) return null;
  return { id: data.user.id, name: p.name, role: p.role as Role, email: data.user.email ?? "", brand_id: p.brand_id };
});

async function requireActor(roles?: Role[]): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new Error("Not signed in");
  if (roles && !roles.includes(a.role)) throw new Error(`Role ${a.role} is not allowed to do this`);
  return a;
}

/** The single place audit rows are written (service role; hash chain is computed by a DB trigger). */
export async function writeAudit(
  actor: { id: string | null; name: string; role: Role | "system" },
  e: {
    submission_id?: string | null; action: string; detail?: Record<string, unknown>;
    version_hash?: string | null; fact_versions?: Record<string, number> | null;
  },
): Promise<void> {
  const admin = createAdmin();
  const { error } = await admin.from("audit_log").insert({
    submission_id: e.submission_id ?? null,
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    action: e.action,
    detail: e.detail ?? {},
    version_hash: e.version_hash ?? null,
    fact_versions: e.fact_versions ?? null,
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

async function citedFactVersions(submissionId: string): Promise<Record<string, number>> {
  const sb = await createClient();
  const { data } = await sb.from("fact_citations").select("fact_code, fact_version").eq("submission_id", submissionId);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.fact_code] = r.fact_version;
  return out;
}

function factCodesIn(findings: Finding[]): string[] {
  const s = new Set<string>();
  for (const f of findings) {
    if (f.citation?.kind === "fact") s.add(f.citation.code);
    if (f.belief?.fact_code) s.add(f.belief.fact_code);
  }
  return [...s];
}

async function latestVersionHash(submissionId: string): Promise<string | null> {
  const sb = await createClient();
  const { data } = await sb.from("versions").select("content_hash").eq("submission_id", submissionId)
    .order("n", { ascending: false }).limit(1).maybeSingle();
  return data?.content_hash ?? null;
}

// ------------------------------------------------------------------ session / brand

export async function getSessionUser(): Promise<{ id: string; name: string; role: Role; email: string } | null> {
  const a = await getActor();
  return a ? { id: a.id, name: a.name, role: a.role, email: a.email } : null;
}

export async function getBrand(): Promise<BrandSpace> {
  const a = await requireActor();
  const sb = await createClient();
  const [brand, clauses, facts, terms, personas] = await Promise.all([
    sb.from("brands").select("*").eq("id", a.brand_id).single(),
    sb.from("clauses").select("*").eq("brand_id", a.brand_id).order("code"),
    sb.from("facts").select("id, code, statement, source, owner, expires_on, version, status").eq("brand_id", a.brand_id).order("code"),
    sb.from("terms").select("*").eq("brand_id", a.brand_id).order("kind").order("phrase"),
    sb.from("personas").select("*").eq("brand_id", a.brand_id).order("name"),
  ]);
  const b = must(brand, "getBrand");
  return {
    id: b.id,
    name: b.name,
    voice_traits: b.voice_traits ?? [],
    palette: mapPalette(b.palette),
    clauses: must(clauses, "clauses").map(mapClause),
    facts: must(facts, "facts").map(mapFact),
    terms: must(terms, "terms").map(mapTerm),
    personas: must(personas, "personas").map(mapPersona),
  };
}

// ------------------------------------------------------------------ submissions

export async function listSubmissions(filter?: { status?: SubmissionStatus }): Promise<Submission[]> {
  await requireActor();
  const sb = await createClient();
  let q = sb.from("submissions").select(SUBMISSION_SELECT).order("number", { ascending: false });
  if (filter?.status) q = q.eq("status", filter.status);
  return must(await q, "listSubmissions").map(mapSubmission);
}

const ROLE_WORD: Record<Role, string> = { owner: "brand owner", reviewer: "reviewer", creator: "creator", agency: "agency" };

/**
 * Agencies may not read other people's profiles (RLS), so their comment authors come back empty. Look up only the
 * role of those authors with the service client (never the name) and label them by role, e.g. "Velura reviewer".
 */
async function labelHiddenAuthors(rows: Row[], brandId: string): Promise<Row[]> {
  const hidden = [...new Set(rows.filter((r) => !r.author?.name && r.author_id).map((r) => r.author_id as string))];
  if (!hidden.length) return rows;
  const admin = createAdmin();
  const [{ data: roles }, { data: brand }] = await Promise.all([
    admin.from("profiles").select("id, role").in("id", hidden),
    admin.from("brands").select("name").eq("id", brandId).maybeSingle(),
  ]);
  const roleOf = new Map((roles ?? []).map((p: { id: string; role: Role }) => [p.id, p.role]));
  return rows.map((r) => {
    if (r.author?.name) return r;
    const role = roleOf.get(r.author_id);
    if (!role) return r;
    const name = role === "agency" ? "Another agency" : `${brand?.name ?? "Brand"} ${ROLE_WORD[role]}`;
    return { ...r, author: { name, role } };
  });
}

/** Open drift findings on the latest checked version; null when that version has not been checked. */
function openDrift(versions: { n: number; findings: Finding[] | null; summary: unknown }[]): number | null {
  if (!versions.length) return null;
  const latest = versions.reduce((m, v) => (v.n > m.n ? v : m));
  if (!latest.summary) return null;
  return (latest.findings ?? []).filter((f) => f.category === "language_drift" && f.status === "open").length;
}

/** False until migration 0003 (translations, Tamil and Marathi, demo store pages) has been applied. */
export const translationsEnabled = cache(async (): Promise<boolean> => {
  const { error } = await createAdmin().from("submissions").select("master_id").limit(1);
  return !error;
});

/** Translations of a master that the viewer can see (RLS), newest first. */
export async function listVariants(masterId: string): Promise<LinkedSubmission[]> {
  await requireActor();
  const sb = await createClient();
  const { data, error } = await sb.from("submissions").select("id, number, title, lang, status, versions(n, findings, summary)")
    .eq("master_id", masterId).order("number", { ascending: false });
  if (error) return []; // before migration 0003 there is no master_id column: no translations yet
  return (data ?? []).map((r) => ({
    id: r.id, number: r.number, title: r.title, lang: r.lang as Lang, status: r.status as SubmissionStatus,
    flagged: openDrift((r.versions ?? []) as { n: number; findings: Finding[]; summary: unknown }[]),
  }));
}

/**
 * The master a translation points at, read with the service client: an agency may translate a master it cannot
 * otherwise open (RLS hides other authors' work), and needs its number, title and latest copy to do the job.
 */
export async function getMaster(masterId: string): Promise<(LinkedSubmission & { body: string; version: number; version_id: string; channel: Channel; intent: string }) | null> {
  const a = await requireActor();
  if (!isUuid(masterId)) return null;
  const admin = createAdmin();
  const { data } = await admin.from("submissions").select("id, brand_id, number, title, lang, status, channel, intent, versions(id, n, body)")
    .eq("id", masterId).maybeSingle();
  if (!data || data.brand_id !== a.brand_id) return null;
  const versions = (data.versions ?? []) as { id: string; n: number; body: string }[];
  if (!versions.length) return null;
  const latest = versions.reduce((m, v) => (v.n > m.n ? v : m));
  return {
    id: data.id, number: data.number, title: data.title, lang: data.lang as Lang, status: data.status as SubmissionStatus,
    flagged: null, body: latest.body, version: latest.n, version_id: latest.id, channel: data.channel as Channel, intent: data.intent ?? "",
  };
}

export async function getSubmission(id: string): Promise<{
  submission: Submission; versions: Version[]; comments: Comment[]; audit: AuditEntry[];
} | null> {
  const actor = await requireActor();
  if (!isUuid(id)) return null; // a mistyped link is "not found", not a database error
  const sb = await createClient();
  const { data: s, error } = await sb.from("submissions").select(SUBMISSION_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`getSubmission: ${error.message}`);
  if (!s) return null;
  const [v, c, a] = await Promise.all([
    sb.from("versions").select("*").eq("submission_id", id).order("n"),
    sb.from("comments").select(COMMENT_SELECT).eq("submission_id", id).order("created_at"),
    sb.from("audit_log").select("*").eq("submission_id", id).order("id"),
  ]);
  return {
    submission: mapSubmission(s),
    versions: must(v, "versions").map(mapVersion),
    comments: (await labelHiddenAuthors(must(c, "comments"), actor.brand_id)).map(mapComment),
    audit: must(a, "audit").map(mapAudit),
  };
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export async function createSubmission(input: {
  title: string; channel: Channel; lang: Lang; intent: string; body: string; lockedPhrases: string[];
  image?: { data: Buffer; mime: string; alt: string | null };
  masterId?: string | null; // set when this draft translates another submission
  sourceFile?: string | null; // the DOCX/PDF/TXT the copy was imported from, kept in the audit entry
}): Promise<{ submissionId: string; versionId: string }> {
  const a = await requireActor();
  const sb = await createClient();

  let master: Awaited<ReturnType<typeof getMaster>> = null;
  if (input.masterId) {
    master = await getMaster(input.masterId);
    if (!master) throw new Error("The master draft was not found.");
    if (master.lang !== "en") throw new Error("Translations are made from an English master.");
    if (input.lang === "en") throw new Error("Pick the language of the translation.");
    const { data: m } = await createAdmin().from("submissions").select("master_id").eq("id", master.id).maybeSingle();
    if (m?.master_id) throw new Error("That draft is itself a translation; translate its English master instead.");
  }

  let imagePath: string | null = null;
  let imageKey = "";
  if (input.image) {
    imagePath = `${a.id}/${randomUUID()}.${extFromMime(input.image.mime)}`;
    imageKey = sha256(input.image.data);
    const up = await sb.storage.from("assets").upload(imagePath, input.image.data, {
      contentType: input.image.mime, upsert: false,
    });
    if (up.error) throw new Error(`image upload failed: ${up.error.message}`);
  }

  const sub = must(
    await sb.from("submissions").insert({
      brand_id: a.brand_id, title: input.title, channel: input.channel, lang: input.lang,
      intent: input.intent, status: "draft", author_id: a.id, locked_phrases: input.lockedPhrases,
      ...(master ? { master_id: master.id } : {}),
    }).select("id").single(),
    "createSubmission",
  );
  const hash = sha256(`${input.body}\n${imageKey}\n${input.image?.alt ?? ""}`);
  const ver = must(
    await sb.from("versions").insert({
      submission_id: sub.id, n: 1, body: input.body, image_path: imagePath,
      image_alt: input.image?.alt ?? null, content_hash: hash,
    }).select("id").single(),
    "createSubmission(version)",
  );
  await writeAudit(a, {
    submission_id: sub.id, action: "submission_created", version_hash: hash,
    detail: {
      title: input.title, channel: input.channel, version: 1,
      ...(master ? { translation_of: master.number, lang: input.lang } : {}),
      ...(input.sourceFile ? { source_file: input.sourceFile } : {}),
    },
  });
  return { submissionId: sub.id, versionId: ver.id };
}

export async function addVersion(
  submissionId: string,
  input: { body: string; image_path?: string | null; image_alt?: string | null },
): Promise<string> {
  const a = await requireActor();
  const sb = await createClient();
  const { data: last } = await sb.from("versions").select("n, image_path, image_alt").eq("submission_id", submissionId)
    .order("n", { ascending: false }).limit(1).maybeSingle();
  const n = (last?.n ?? 0) + 1;
  const image_path = input.image_path !== undefined ? input.image_path : (last?.image_path ?? null);
  const image_alt = input.image_alt !== undefined ? input.image_alt : (last?.image_alt ?? null);
  const hash = sha256(`${input.body}\n${image_path ?? ""}\n${image_alt ?? ""}`);
  // a changed draft needs a fresh review: an approved, published or in-review submission goes back to draft
  const cur = must(await sb.from("submissions").select("status, locked_phrases").eq("id", submissionId).single(), "addVersion(status)");
  const lost = ((cur.locked_phrases ?? []) as string[]).filter((p) => p.trim() && !input.body.toLowerCase().includes(p.toLowerCase()));
  if (lost.length) throw new Error(`These phrases must stay in the copy: ${lost.map((p) => `"${p}"`).join(", ")}`);
  // a new version may keep the current image or drop it; it cannot point at some other stored file
  if (input.image_path && input.image_path !== (last?.image_path ?? null)) throw new Error("That image does not belong to this draft");
  const row = must(
    await sb.from("versions").insert({
      submission_id: submissionId, n, body: input.body, image_path, image_alt, content_hash: hash,
    }).select("id").single(),
    "addVersion",
  );
  await writeAudit(a, { submission_id: submissionId, action: "version_added", version_hash: hash, detail: { version: n } });
  if (cur.status === "approved" || cur.status === "published" || cur.status === "in_review") {
    must(await sb.from("submissions").update({ status: "draft" }).eq("id", submissionId).select("id").single(), "addVersion(reset)");
    await writeAudit(a, { submission_id: submissionId, action: "returned_to_draft", version_hash: hash, detail: { from: cur.status, to: "draft", reason: `v${n} saved` } });
  }
  return row.id;
}

/** summary === null is a mid-run checkpoint: findings so far are stored, citations and audit wait for the final save. */
export async function saveCheckResult(versionId: string, findings: Finding[], summary: CheckSummary | null): Promise<void> {
  const a = await requireActor();
  const sb = await createClient();
  // only the latest version is checked (an older check would overwrite the current version's fact citations),
  // and decisions already made on a finding carry over when the same finding comes back from a re-run
  const cur = must(await sb.from("versions").select("submission_id, n, findings").eq("id", versionId).single(), "saveCheckResult(read)");
  const { data: newest } = await sb.from("versions").select("n").eq("submission_id", cur.submission_id).order("n", { ascending: false }).limit(1).single();
  if (newest && newest.n !== cur.n) throw new Error(`v${cur.n} is not the latest version; check v${newest.n} instead`);
  const prior = new Map(((cur.findings ?? []) as Finding[]).filter((f) => f.status !== "open").map((f) => [`${f.id}|${f.span?.text ?? f.title}`, f]));
  findings = findings.map((f) => {
    const p = prior.get(`${f.id}|${f.span?.text ?? f.title}`);
    return p ? { ...f, status: p.status, dispute_note: p.dispute_note, applied_replacement: p.applied_replacement } : f;
  });
  if (!summary) {
    must(await sb.from("versions").update({ findings }).eq("id", versionId).select("id").single(), "saveCheckResult checkpoint");
    return;
  }
  const v = must(
    await sb.from("versions").update({ findings, summary }).eq("id", versionId)
      .select("submission_id, n, content_hash").single(),
    "saveCheckResult",
  );

  // Record which fact versions this check relied on (powers recall + audit).
  const codes = factCodesIn(findings);
  await sb.from("fact_citations").delete().eq("submission_id", v.submission_id);
  if (codes.length) {
    const { data: facts } = await sb.from("facts").select("code, version").eq("brand_id", a.brand_id).in("code", codes);
    const rows = (facts ?? []).map((f) => ({ submission_id: v.submission_id, fact_code: f.code, fact_version: f.version }));
    if (rows.length) must(await sb.from("fact_citations").insert(rows), "fact_citations");
  }
  await writeAudit(a, {
    submission_id: v.submission_id, action: "check_run", version_hash: v.content_hash,
    detail: {
      version: v.n, rule_count: summary.rule_count, ai_count: summary.ai_count, high: summary.high,
      mode: summary.mode, model: summary.model,
    },
    fact_versions: await citedFactVersions(v.submission_id),
  });
}

export async function updateFinding(
  versionId: string, findingId: string, patch: Partial<Pick<Finding, "status" | "dispute_note" | "applied_replacement">>,
): Promise<void> {
  const a = await requireActor();
  const sb = await createClient();
  const v = must(await sb.from("versions").select("submission_id, n, findings, content_hash").eq("id", versionId).single(), "updateFinding");
  const findings = (v.findings ?? []) as Finding[];
  const idx = findings.findIndex((f) => f.id === findingId);
  if (idx < 0) throw new Error(`Finding ${findingId} not found`);
  findings[idx] = { ...findings[idx], ...patch };
  must(await sb.from("versions").update({ findings }).eq("id", versionId).select("id").single(), "updateFinding(save)");
  if (patch.status) {
    await writeAudit(a, {
      submission_id: v.submission_id, action: `finding_${patch.status}`, version_hash: v.content_hash,
      detail: { finding_id: findingId, title: findings[idx].title, version: v.n, note: patch.dispute_note ?? null },
    });
  }
}

export async function addComment(submissionId: string, versionN: number, body: string, anchor: Span | null): Promise<void> {
  const a = await requireActor();
  const sb = await createClient();
  must(
    await sb.from("comments").insert({ submission_id: submissionId, version_n: versionN, author_id: a.id, body, anchor }).select("id").single(),
    "addComment",
  );
}

const STATUS_ACTION: Record<SubmissionStatus, string> = {
  draft: "reverted_to_draft",
  in_review: "submitted_for_review",
  changes_requested: "requested_changes",
  approved: "approved",
  published: "published",
  recalled: "recalled",
};

// Allowed status changes. "published" is reached only by recording a live URL; a new version resets to "draft".
const TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  draft: ["in_review"],
  changes_requested: ["in_review"],
  in_review: ["approved", "changes_requested"],
  approved: ["recalled", "changes_requested"],
  published: ["recalled"],
  recalled: [],
};
const REVIEW_ONLY: SubmissionStatus[] = ["approved", "changes_requested", "recalled"];

export async function setStatus(submissionId: string, status: SubmissionStatus, note?: string): Promise<void> {
  const a = await requireActor();
  if (REVIEW_ONLY.includes(status) && a.role !== "reviewer" && a.role !== "owner") {
    throw new Error("Only a reviewer or the brand owner can make this decision");
  }
  const sb = await createClient();
  const before = must(await sb.from("submissions").select("status, author_id").eq("id", submissionId).single(), "setStatus");
  if (!TRANSITIONS[before.status as SubmissionStatus].includes(status)) {
    throw new Error(`A submission that is ${before.status.replace("_", " ")} cannot move to ${status.replace("_", " ")}`);
  }
  if (status === "approved" && before.author_id === a.id) throw new Error("You cannot approve your own draft; ask another reviewer");
  must(await sb.from("submissions").update({ status }).eq("id", submissionId).select("id").single(), "setStatus(update)");
  await writeAudit(a, {
    submission_id: submissionId,
    action: STATUS_ACTION[status],
    version_hash: await latestVersionHash(submissionId),
    fact_versions: await citedFactVersions(submissionId),
    detail: { from: before.status, to: status, note: note ?? null },
  });
}

export async function recordPublishedUrl(submissionId: string, url: string): Promise<void> {
  const a = await requireActor();
  const sb = await createClient();
  const cur = must(await sb.from("submissions").select("status").eq("id", submissionId).single(), "recordPublishedUrl");
  if (cur.status !== "approved" && cur.status !== "published") throw new Error("Only an approved submission can be published");
  if (!/^https?:[/][/]/i.test(url)) throw new Error("Enter the full link, starting with https://");
  const patch: Record<string, unknown> = { published_url: url };
  if (cur.status === "approved") patch.status = "published";
  must(await sb.from("submissions").update(patch).eq("id", submissionId).select("id").single(), "recordPublishedUrl(update)");
  await writeAudit(a, {
    submission_id: submissionId, action: "published_url_recorded",
    version_hash: await latestVersionHash(submissionId),
    fact_versions: await citedFactVersions(submissionId),
    detail: { url, from: cur.status, to: patch.status ?? cur.status },
  });
}

// ------------------------------------------------------------------ brand space writes

/** Returns the fact code when something changed (callers re-check live pages that cite it), or null when unchanged. */
export async function upsertFact(f: Partial<Fact> & { statement: string }): Promise<string | null> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();

  let existing: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (f.id) existing = (await sb.from("facts").select("*").eq("id", f.id).maybeSingle()).data;
  else if (f.code) existing = (await sb.from("facts").select("*").eq("brand_id", a.brand_id).eq("code", f.code).maybeSingle()).data;

  let code = f.code ?? existing?.code;
  if (!code) {
    const { data: codes } = await sb.from("facts").select("code").eq("brand_id", a.brand_id);
    const max = Math.max(0, ...(codes ?? []).map((r) => Number(/(\d+)$/.exec(r.code)?.[1] ?? 0)));
    code = `F-${String(max + 1).padStart(2, "0")}`;
  }

  const expires_on = f.expires_on !== undefined ? f.expires_on : (existing?.expires_on ?? null);
  let status: Fact["status"] = f.status ?? (existing?.status === "retired" ? "retired" : "active");
  if (status === "active" && expires_on && expires_on < todayISO()) status = "expired";
  // saving an unchanged fact must not bump its version or re-queue every post that cites it
  if (
    existing && existing.statement === f.statement && existing.status === status && (existing.expires_on ?? null) === expires_on &&
    (f.source ?? existing.source) === existing.source && (f.owner ?? existing.owner) === existing.owner
  ) return null;
  const version = existing ? existing.version + 1 : 1;

  const row: Record<string, unknown> = {
    brand_id: a.brand_id, code, statement: f.statement,
    source: f.source ?? existing?.source ?? "", owner: f.owner ?? existing?.owner ?? "",
    expires_on, status, version, updated_at: new Date().toISOString(),
  };
  if (!existing || existing.statement !== f.statement) {
    const { data: emb_terms } = await sb.from("terms").select("phrase").eq("brand_id", a.brand_id).eq("kind", "embargo");
    const emb = await embedText(f.statement, (emb_terms ?? []).map((t: { phrase: string }) => t.phrase)); // null when no key or out of quota
    // without a new vector an edited fact keeps its previous one (close to the new wording) rather than dropping out of
    // fact matching; the daily sweep re-embeds recently edited facts once the quota allows
    if (emb) row.embedding = toVectorLiteral(emb);
    else if (!existing) row.embedding = null;
  }
  must(await sb.from("facts").upsert(row, { onConflict: "brand_id,code" }).select("id").single(), "upsertFact");

  await writeAudit(a, {
    action: existing ? "fact_edited" : "fact_created",
    fact_versions: { [code]: version },
    detail: { code, from_version: existing?.version ?? null, to_version: version, status, expires_on },
  });

  // Enqueue recall: approved/published pieces that cite an older version, or an expired/retired fact.
  if (existing || status !== "active") {
    const { data: cites } = await sb.from("fact_citations")
      .select("submission_id, fact_version, submission:submissions!inner(status)")
      .eq("fact_code", code).in("submission.status", ["approved", "published"]);
    const seen = new Set<string>();
    for (const c of cites ?? []) {
      if (seen.has(c.submission_id)) continue;
      const reason = status !== "active"
        ? `${code} is now ${status}`
        : c.fact_version < version ? `${code} changed (cited v${c.fact_version}, now v${version})` : null;
      if (!reason) continue;
      seen.add(c.submission_id);
      await writeAudit(a, {
        submission_id: c.submission_id, action: "recall_enqueued",
        fact_versions: { [code]: version }, detail: { fact_code: code, reason },
      });
    }
  }
  return code;
}

export async function upsertClause(c: Partial<Clause> & { code: string; title: string; body: string }): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  must(
    await sb.from("clauses").upsert({
      brand_id: a.brand_id, code: c.code, title: c.title, body: c.body,
      kind: c.kind ?? "ai", confirmed: c.confirmed ?? true,
    }, { onConflict: "brand_id,code" }).select("id").single(),
    "upsertClause",
  );
  await writeAudit(a, { action: "clause_edited", detail: { code: c.code, title: c.title } });
}

export async function upsertTerm(t: Partial<Term> & { kind: TermKind; phrase: string }): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  const row = {
    brand_id: a.brand_id, kind: t.kind, phrase: t.phrase, replacement: t.replacement ?? null,
    clause_code: t.clause_code ?? null, triggers: t.triggers ?? null,
  };
  if (t.id) must(await sb.from("terms").update(row).eq("id", t.id).select("id").single(), "upsertTerm");
  else must(await sb.from("terms").upsert(row, { onConflict: "brand_id,kind,phrase" }).select("id").single(), "upsertTerm");
  await writeAudit(a, { action: "term_edited", detail: { kind: t.kind, phrase: t.phrase } });
}

export async function deleteTerm(id: string): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  const { data } = await sb.from("terms").select("kind, phrase").eq("id", id).maybeSingle();
  must(await sb.from("terms").delete().eq("id", id).select("id"), "deleteTerm");
  await writeAudit(a, { action: "term_deleted", detail: { kind: data?.kind ?? null, phrase: data?.phrase ?? null } });
}

export async function updateBrand(voice_traits: string[], palette: PaletteColor[]): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  must(await sb.from("brands").update({ voice_traits, palette }).eq("id", a.brand_id).select("id").single(), "updateBrand");
  await writeAudit(a, { action: "brand_edited", detail: { voice_traits, palette_size: palette.length } });
}

export async function upsertPersona(p: Partial<Persona> & { name: string; description: string }): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  const row = {
    brand_id: a.brand_id, name: p.name, description: p.description, lang: p.lang ?? "en", builtin: p.builtin ?? false,
  };
  if (p.id) must(await sb.from("personas").update(row).eq("id", p.id).select("id").single(), "upsertPersona");
  else must(await sb.from("personas").upsert(row, { onConflict: "brand_id,name" }).select("id").single(), "upsertPersona");
  await writeAudit(a, { action: "persona_edited", detail: { name: p.name } });
}

export async function importGuidelineClauses(clauses: Omit<Clause, "id">[]): Promise<void> {
  const a = await requireActor(["owner"]);
  const sb = await createClient();
  if (!clauses.length) return;
  const rows = clauses.map((c) => ({
    brand_id: a.brand_id, code: c.code, title: c.title, body: c.body, kind: c.kind, confirmed: c.confirmed,
  }));
  must(await sb.from("clauses").upsert(rows, { onConflict: "brand_id,code" }).select("id"), "importGuidelineClauses");
  await writeAudit(a, { action: "guideline_imported", detail: { count: clauses.length, codes: clauses.map((c) => c.code) } });
}

// ------------------------------------------------------------------ recall / insights

/** Recall queue, live-page checks and expiry alerts for the viewer's brand (RLS applies). See lib/recall/queue.ts. */
export async function getRecallState(): Promise<import("../recall/queue").RecallState> {
  const a = await requireActor();
  const { recallState } = await import("../recall/queue");
  return recallState(await createClient(), a.brand_id);
}

export async function getInsights(): Promise<{
  topClauses: { code: string; title: string; count: number }[];
  byAuthor: { name: string; role: Role; findings: number; high: number }[];
  unclear: { code: string; title: string; disputeRate: number; splitCount: number }[];
  staleFacts: Fact[];
}> {
  const a = await requireActor();
  const sb = await createClient();
  const [subs, clauses, facts] = await Promise.all([
    sb.from("submissions").select("id, author:profiles!submissions_author_id_fkey(name, role), versions(n, findings)"),
    sb.from("clauses").select("code, title").eq("brand_id", a.brand_id),
    sb.from("facts").select("id, code, statement, source, owner, expires_on, version, status").eq("brand_id", a.brand_id),
  ]);
  const titles = new Map<string, string>((must(clauses, "insights clauses") as { code: string; title: string }[]).map((c) => [c.code, c.title]));

  const byClause = new Map<string, { total: number; disputed: number; split: number }>();
  const byAuthor = new Map<string, { name: string; role: Role; findings: number; high: number }>();

  for (const s of must(subs, "insights submissions") as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const versions = (s.versions ?? []) as { n: number; findings: Finding[] }[];
    if (!versions.length) continue;
    const latest = versions.reduce((m, v) => (v.n > m.n ? v : m));
    const author = (Array.isArray(s.author) ? s.author[0] : s.author) as { name: string; role: Role } | null;
    const key = author?.name ?? "Unknown";
    const row = byAuthor.get(key) ?? { name: key, role: author?.role ?? "creator", findings: 0, high: 0 };
    for (const f of latest.findings ?? []) {
      row.findings += 1;
      if (f.severity === "high") row.high += 1;
      const clauseCode = f.citation?.kind === "clause" ? f.citation.code : f.clause_code;
      if (clauseCode) {
        const c = byClause.get(clauseCode) ?? { total: 0, disputed: 0, split: 0 };
        c.total += 1;
        if (f.status === "disputed") c.disputed += 1;
        if (f.belief?.verdict === "ambiguous") c.split += 1;
        byClause.set(clauseCode, c);
      }
    }
    byAuthor.set(key, row);
  }

  const topClauses = [...byClause.entries()]
    .map(([code, v]) => ({ code, title: titles.get(code) ?? code, count: v.total }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 8);
  const unclear = [...byClause.entries()]
    .map(([code, v]) => ({ code, title: titles.get(code) ?? code, disputeRate: v.total ? v.disputed / v.total : 0, splitCount: v.split }))
    .filter((u) => u.disputeRate >= 0.25 || u.splitCount > 0)
    .sort((x, y) => y.disputeRate + y.splitCount * 0.1 - (x.disputeRate + x.splitCount * 0.1));

  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const staleFacts = (must(facts, "insights facts") as Record<string, any>[]).map(mapFact) // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((f) => f.status !== "retired" && (f.status === "expired" || (f.expires_on !== null && f.expires_on <= soon)))
    .sort((x, y) => (x.expires_on ?? "9").localeCompare(y.expires_on ?? "9"));

  return { topClauses, byAuthor: [...byAuthor.values()].sort((x, y) => y.findings - x.findings), unclear, staleFacts };
}

// ------------------------------------------------------------------ storage / vectors

export async function signedImageUrl(path: string): Promise<string | null> {
  if (!path) return null;
  await requireActor();
  const sb = await createClient();
  const { data, error } = await sb.storage.from("assets").createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

export async function matchFacts(embedding: number[], k: number): Promise<{ fact: Fact; similarity: number }[]> {
  const a = await requireActor();
  const sb = await createClient();
  const { data, error } = await sb.rpc("match_facts", { query: toVectorLiteral(embedding), k, brand: a.brand_id });
  if (error) {
    console.warn("[readback] match_facts failed:", error.message);
    return [];
  }
  return ((data ?? []) as any[]).map((r) => ({ fact: mapFact(r), similarity: Number(r.similarity) })); // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ------------------------------------------------------------------ audit chain / demo auth

export async function verifyAuditChain(): Promise<{ ok: boolean; brokenAt: number | null }> {
  await requireActor();
  const sb = await createClient();
  const { data, error } = await sb.rpc("verify_audit_chain");
  if (error) throw new Error(`verifyAuditChain: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; broken_at: number | string | null } | undefined;
  return { ok: row?.ok ?? false, brokenAt: row?.broken_at == null ? null : Number(row.broken_at) };
}

/** Server-only: sign in as one of the seeded demo users (sets the session cookies). */
export async function signInAsRole(role: Role): Promise<{ ok: boolean; error: string | null }> {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return { ok: false, error: "DEMO_PASSWORD is not set" };
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email: DEMO_EMAILS[role], password });
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}
