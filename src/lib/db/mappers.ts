// Pure row -> domain mappers (no Next.js imports so scripts can reuse them).
import type {
  AuditEntry, Channel, Clause, Comment, Fact, Lang, PaletteColor, Persona, Role,
  Submission, SubmissionStatus, Term, TermKind, Version, Finding, CheckSummary, Span,
} from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function mapClause(r: Row): Clause {
  return { id: r.id, code: r.code, title: r.title, body: r.body ?? "", kind: r.kind, confirmed: !!r.confirmed };
}

export function mapFact(r: Row): Fact {
  const expired = r.expires_on && r.expires_on < todayISO();
  return {
    id: r.id,
    code: r.code,
    statement: r.statement,
    source: r.source ?? "",
    owner: r.owner ?? "",
    expires_on: r.expires_on ?? null,
    version: r.version,
    status: r.status === "active" && expired ? "expired" : r.status,
  };
}

export function mapTerm(r: Row): Term {
  return {
    id: r.id,
    kind: r.kind as TermKind,
    phrase: r.phrase,
    replacement: r.replacement ?? null,
    clause_code: r.clause_code ?? null,
    triggers: r.triggers ?? null,
  };
}

export function mapPersona(r: Row): Persona {
  return { id: r.id, name: r.name, description: r.description ?? "", lang: r.lang as Lang, builtin: !!r.builtin };
}

export function mapPalette(v: unknown): PaletteColor[] {
  return Array.isArray(v) ? (v as PaletteColor[]) : [];
}

export function mapSubmission(r: Row): Submission {
  const a = (r.author ?? {}) as Row;
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    channel: r.channel as Channel,
    lang: r.lang as Lang,
    intent: r.intent ?? "",
    status: r.status as SubmissionStatus,
    author_id: r.author_id,
    author_name: a.name ?? "Unknown",
    author_role: (a.role ?? "creator") as Role,
    locked_phrases: r.locked_phrases ?? [],
    published_url: r.published_url ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function mapVersion(r: Row): Version {
  return {
    id: r.id,
    submission_id: r.submission_id,
    n: r.n,
    body: r.body,
    image_path: r.image_path ?? null,
    image_alt: r.image_alt ?? null,
    content_hash: r.content_hash ?? "",
    findings: (r.findings ?? []) as Finding[],
    summary: (r.summary ?? null) as CheckSummary | null,
    created_at: r.created_at,
  };
}

export function mapComment(r: Row): Comment {
  const a = (r.author ?? {}) as Row;
  return {
    id: r.id,
    submission_id: r.submission_id,
    version_n: r.version_n,
    author_name: a.name ?? "Unknown",
    author_role: (a.role ?? "creator") as Role,
    body: r.body,
    anchor: (r.anchor ?? null) as Span | null,
    created_at: r.created_at,
  };
}

export function mapAudit(r: Row): AuditEntry {
  return {
    id: Number(r.id),
    submission_id: r.submission_id ?? null,
    actor_name: r.actor_name,
    actor_role: r.actor_role as Role,
    action: r.action,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    version_hash: r.version_hash ?? null,
    fact_versions: (r.fact_versions ?? null) as Record<string, number> | null,
    prev_hash: r.prev_hash,
    hash: r.hash,
    created_at: r.created_at,
  };
}
