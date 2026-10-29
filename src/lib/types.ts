// Shared domain contract for Readback. Every module (rules, ai, db, ui) codes against these types.

export type Role = "owner" | "creator" | "reviewer" | "agency";

export type Channel = "instagram" | "website" | "amazon" | "nykaa" | "whatsapp" | "email" | "other";
export type Lang = "en" | "hi" | "hinglish" | "ta" | "mr";

export type ClauseKind = "rule" | "ai"; // rule = checked by deterministic code, ai = checked by Impression Engine

export interface Clause {
  id: string; // uuid
  code: string; // e.g. "G-12"
  title: string;
  body: string;
  kind: ClauseKind;
  confirmed: boolean; // owner confirmed after PDF import
}

export interface Fact {
  id: string; // uuid
  code: string; // e.g. "F-07"
  statement: string; // "71% of users saw more radiant skin at week 4 (n=112, in-vivo)"
  source: string; // "Clinical study VEL-CS-2025-03"
  owner: string;
  expires_on: string | null; // ISO date
  version: number; // bumps on every edit
  status: "active" | "expired" | "retired";
}

export type TermKind = "banned" | "preferred" | "disclaimer" | "embargo";

export interface Term {
  id: string;
  kind: TermKind;
  phrase: string; // matched case-insensitively
  replacement: string | null; // for banned: suggested alternative; for disclaimer: null
  clause_code: string | null; // guideline it enforces
  // disclaimer only: phrase must appear when any trigger matches
  triggers?: string[] | null;
}

export interface PaletteColor {
  name: string;
  hex: string; // "#E8A33D"
}

export interface Persona {
  id: string;
  name: string; // "Literal first-time buyer"
  description: string;
  lang: Lang;
  builtin: boolean; // the 3 fixed personas: literal buyer, Hindi/Hinglish reader, ASCI sceptic
}

export interface BrandSpace {
  id: string;
  name: string;
  voice_traits: string[]; // ["warm", "evidence-led", "never pushy"]
  palette: PaletteColor[];
  clauses: Clause[];
  facts: Fact[];
  terms: Term[];
  personas: Persona[];
}

// ---------- Findings ----------

export type Engine = "rule" | "ai";
export type Severity = "high" | "medium" | "low";
export type FindingCategory =
  | "terminology"
  | "disclaimer"
  | "embargo"
  | "accessibility"
  | "visual"
  | "tone"
  | "claim"
  | "language_drift";

export type BeliefCategory =
  | "efficacy"
  | "health"
  | "environment"
  | "price"
  | "guarantee"
  | "comparison"
  | "endorsement"
  | "urgency";

export type Verdict = "supported" | "contradicted" | "unsupported" | "ambiguous";

export interface Span {
  start: number; // char offset into draft text (unmasked)
  end: number;
  text: string;
}

export interface Finding {
  id: string;
  engine: Engine; // shown as [RULE] / [AI]
  category: FindingCategory;
  severity: Severity;
  title: string; // "Banned term: “zero chemicals”"
  explanation: string; // why it was flagged, plain English
  citation: { kind: "clause" | "fact" | "wcag"; code: string; text: string } | null;
  // guideline clause this finding falls under, even when the citation is a fact (feeds Insights)
  clause_code?: string | null;
  span: Span | null;
  model: string | null; // e.g. "gemini-2.5-flash" for AI findings
  // AI claim findings only
  belief?: {
    statement: string; // "Results are guaranteed within 1 week"
    category: BeliefCategory;
    readers: number; // k readers who formed it
    of: number; // out of n
    reader_names: string[];
    verdict: Verdict;
    fact_code: string | null;
    visual_element: string | null;
  };
  // translations only: how the belief changed from the English master
  drift_kind?: "new_belief" | "strengthened" | "dropped_qualifier";
  // measured values for rule findings (e.g. contrast)
  measured?: Record<string, string | number>;
  suggestion: Suggestion | null;
  status: "open" | "accepted" | "edited" | "disputed" | "dismissed";
  dispute_note?: string;
  applied_replacement?: string | null; // the wording the author accepted or edited, kept until they save the next version
}

export interface Suggestion {
  replacement: string; // replaces finding.span.text only
  rationale: string;
  source?: "translation"; // wording from the bilingual comparison; its gate is a re-comparison with the master
  // Re-read gate results; suggestion is only shown if passed === true
  reread: {
    passed: boolean;
    unsupported_before: number;
    unsupported_after: number;
    new_unsupported: number;
    still_held?: boolean; // readers still formed this finding's belief after the rewrite
    tone_still_off?: boolean;
    locked_broken?: boolean;
    untested?: boolean; // overlapped another fix, so it was not part of the combined re-read
    intent_kept: number; // readers who still get declared intent
    of: number;
  } | null;
}

export interface ReaderResult {
  persona_id: string;
  persona_name: string;
  takeaway: string; // one-sentence summary of what this reader believes the ad says
  tone: string[]; // adjectives e.g. ["pushy", "salesy"]
  intent_match: boolean; // does reader get the creator's declared takeaway?
  beliefs: {
    belief: string;
    trigger_quote: string;
    visual_element: string | null;
    category: BeliefCategory;
    confidence: number; // 0..1
    grounded: boolean; // set by grounding guard
  }[];
}

// Streamed from POST /api/check as NDJSON, one event per line
export type CheckEvent =
  | { type: "stage"; stage: "mask" | "rules" | "readers" | "group" | "verify" | "drift" | "fix" | "done"; message: string }
  | { type: "rules"; findings: Finding[]; ms: number }
  | { type: "reader"; result: ReaderResult }
  | { type: "findings"; findings: Finding[] } // AI findings after group+verify
  | { type: "suggestion"; finding_id: string; suggestion: Suggestion }
  | { type: "summary"; summary: CheckSummary }
  | { type: "error"; message: string };

export interface CheckSummary {
  rule_count: number;
  ai_count: number;
  high: number;
  intent_kept: number;
  of: number;
  ms_total: number;
  model: string;
  mode: "cloud" | "mock";
  masked_tokens: number; // how many PII/embargo items were masked before model calls
  readers?: ReaderResult[]; // each reader's takeaway from this check, so the panel survives a reload
  own_key?: boolean; // ran on the viewer's own Gemini key rather than the shared free one
  partial?: boolean; // the AI stage did not complete (quota, overload); only rule findings are reliable
  partial_reason?: string; // why, in plain words
  drift?: DriftSummary; // translations only: what readers believe from the master versus this version
  embeddings?: string; // embedding model that grouped the beliefs, or "lexical" when every model was out of quota
}

// ---------- Translations ----------

export type DriftKind = "new_belief" | "strengthened" | "weakened" | "dropped" | "same";

export interface DriftSide {
  belief: string;
  quote: string;
  strength: number; // 1 hedged, 2 plain claim, 3 absolute
  readers: number;
}

export interface DriftRow {
  kind: DriftKind;
  category: BeliefCategory;
  master: DriftSide | null;
  variant: DriftSide | null;
  explanation: string;
  fix?: string | null; // variant-language wording that keeps the master's strength (flagged rows only)
}

/** Stored with a translation's check: the master it was compared with and the paired beliefs. */
export interface DriftSummary {
  master_id: string;
  master_number: number;
  master_version: number;
  master_lang: Lang;
  master_body: string;
  rows: DriftRow[];
  of: number;
  failed?: string; // the drift call did not complete; the reason
}

// ---------- Workflow ----------

export type SubmissionStatus = "draft" | "in_review" | "changes_requested" | "approved" | "published" | "recalled";

export interface Submission {
  id: string;
  number: number; // human #142
  title: string;
  channel: Channel;
  lang: Lang;
  intent: string; // declared one-line takeaway
  status: SubmissionStatus;
  author_id: string;
  author_name: string;
  author_role: Role;
  locked_phrases: string[];
  published_url: string | null;
  master_id: string | null; // set on a translation: the submission it translates
  created_at: string;
  updated_at: string;
}

/** A translation as listed on its master, or the master as shown on a translation. */
export interface LinkedSubmission {
  id: string;
  number: number;
  title: string;
  lang: Lang;
  status: SubmissionStatus;
  flagged: number | null; // drift findings still open on the latest checked version; null = not checked yet
}

export interface Version {
  id: string;
  submission_id: string;
  n: number; // v1, v2...
  body: string;
  image_path: string | null; // storage path in private bucket
  image_alt: string | null;
  content_hash: string;
  findings: Finding[];
  summary: CheckSummary | null;
  created_at: string;
}

export interface Comment {
  id: string;
  submission_id: string;
  version_n: number;
  author_name: string;
  author_role: Role;
  body: string;
  anchor: Span | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  submission_id: string | null;
  actor_name: string;
  actor_role: Role;
  action: string; // "approved", "requested_changes", "fact_edited", ...
  detail: Record<string, unknown>;
  version_hash: string | null;
  fact_versions: Record<string, number> | null; // { "F-07": 2 }
  prev_hash: string; // hash chain -> tamper evident
  hash: string;
  created_at: string;
}
