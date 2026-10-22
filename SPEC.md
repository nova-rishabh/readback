# Readback: Build Spec (Round 2)

Readback is a pre-publication brand and claim governance tool. It runs two engines side by side:
- **Rule Engine** (plain code): exact checks.
- **Impression Engine** (Gemini): 6 simulated readers report what they *believe* after reading the copy and seeing the image. Those beliefs are grounded, grouped, and verified against a Fact Ledger, and fixes go through a re-read gate.

The demo brand is **Velura**, a fictional Indian skincare D2C brand. The hero draft is #142: *"Dermatologist-loved Vitamin C serum. Visible glow in 7 days. 100% natural, zero chemicals. Shop now"*, posted with a model in a white lab coat and green leaves.

Shared types live in `src/lib/types.ts`. **Do not change them without being asked.** If you need an extra field, add it as optional and mention it in your final report.

## Stack
- Next.js 15 App Router, TypeScript strict, Tailwind v4, no shadcn CLI (write the small primitives by hand in `src/components/ui/`)
- Supabase: Postgres, Auth, Storage (private bucket `assets`), pgvector
- Vercel AI SDK v4 (`ai@4`, `@ai-sdk/google@1`), zod v3
- Gemini: `GEMINI_MODEL` env, default `gemini-2.5-flash`; embeddings `text-embedding-004` (768 dims)
- sharp (pixels), diff (word diffs), vitest
- pnpm

## Env (`.env.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only: seeding + audit writes
GOOGLE_GENERATIVE_AI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
DEMO_PASSWORD=                  # password shared by the seeded demo users
READBACK_MOCK_AI=0              # 1 = deterministic mock readers (no key needed)
```

## Module ownership (one owner per folder; do not edit other folders)
| Folder | Owner | Purpose |
|---|---|---|
| `src/lib/rules/`, `src/lib/privacy/` | Rules agent | Rule Engine and Privacy Gate, pure TS plus sharp, with vitest tests |
| `src/lib/ai/` | AI agent | Impression Engine pipeline |
| `supabase/`, `src/lib/db/`, `scripts/`, `src/middleware.ts` | Data agent | schema, RLS, seed, queries, auth |
| `src/app/`, `src/components/` | UI agent | every page, route handler, and server action |

## Module contracts

### Privacy Gate: `src/lib/privacy/gate.ts`
```ts
export function mask(text: string, embargo: string[]): { masked: string; tokens: Map<string,string>; count: number }
export function unmask(text: string, tokens: Map<string,string>): string
```
This masks emails, Indian phone numbers, PAN, Aadhaar, and embargoed terms into tokens like `⟦EMAIL_1⟧` and `⟦EMBARGO_1⟧`. **Every string sent to a model must go through `mask` first.**

### Rule Engine: `src/lib/rules/index.ts`
```ts
export async function runRules(input: { text: string; image?: Buffer | null; imageAlt?: string | null;
  textBoxes?: { text: string; box: [number,number,number,number] }[]; // normalized 0..1 [x,y,w,h], from vision
  brand: BrandSpace; channel: Channel }): Promise<Finding[]>
```
- Aho-Corasick (written by hand in `aho-corasick.ts`) over banned, preferred, and embargo terms, giving char spans. A banned term gets a `suggestion` built from `replacement` (`reread: null`, since rule suggestions don't need the gate).
- Disclaimers: if any trigger phrase appears and the disclaimer phrase is missing, flag it.
- WCAG 1.4.3: for each text box, sample the pixels with sharp, k-means them into 2 clusters (fg/bg), compute the contrast ratio, and flag anything under 4.5:1 (or under 3:1 for large text, where box height > 0.08). Put `measured: { ratio, fg, bg, required }` on the finding.
- WCAG 1.1.1: an image with an empty or missing alt, or an alt that's a filename, gets flagged.
- Palette: take the image's dominant colours (k-means k=5 on a downscaled image). Any dominant colour (>8% of pixels and not near-neutral) whose minimum ΔE2000 to the brand palette is over 20 gets a low-severity flag.
- Every finding has `engine: "rule"` and a citation (a clause code or a WCAG SC).
- Unit tests: the AC matcher, contrast math (#777 on #fff = 4.48), ΔE2000 against known reference pairs, and mask/unmask round-trips.

### Impression Engine: `src/lib/ai/pipeline.ts`
```ts
export async function runCheck(input: {
  text: string; intent: string; lang: Lang; channel: Channel;
  image?: { data: Buffer; mime: string } | null; imageAlt?: string | null;
  lockedPhrases: string[]; brand: BrandSpace;
}, emit: (e: CheckEvent) => void): Promise<{ findings: Finding[]; summary: CheckSummary; readers: ReaderResult[] }>
```
Order of events: mask → vision text-box extraction (if there's an image) → `runRules` (emit `rules`) → 6 readers in parallel (emit each `reader`) → grounding guard → grouping → fact verify (emit `findings`) → span fix plus re-read for each contradicted or unsupported belief, plus tone (emit `suggestion`) → `summary`.
- The 6 readers are 3 brand personas plus 3 built-ins (Literal first-time buyer, Hindi/Hinglish reader, ASCI code sceptic). Each one uses `generateObject` with a zod schema and gets the image too. Invalid output retries once, then the reader is dropped.
- Grounding: `trigger_quote` must fuzzy-match a substring of the draft (normalised; token-overlap ≥ 0.8 or Levenshtein ratio). A `visual_element` is confirmed with a separate yes/no vision call. Anything ungrounded is dropped.
- Grouping: embed the beliefs and do greedy cosine clustering (≥ 0.82). A group needs ≥ 2 of 6 readers to become a finding. A split between 40% and 60% is labelled `ambiguous`.
- Verify: embed the group belief, take the top-3 facts by cosine (via `matchFacts` from the db layer, or in-memory if that's missing), then an LLM judge returns supported, contradicted, or unsupported plus a fact code. With no match the result is "unsupported (no fact in ledger)", never "false".
- Tone: if a majority of readers use a tone adjective that conflicts with `voice_traits`, raise a `tone` finding.
- Fix: the model rewrites **only the trigger span** and must not touch locked phrases. Splice the rewrite in and re-run the panel (reuse the same personas; to save calls, the re-read can batch all 6 readers in one structured call). Set `reread.passed` only if unsupported beliefs drop, no new unsupported beliefs appear, intent is kept by more than half the readers, and the locked phrases are intact. Failing suggestions are still emitted, with `passed: false`, so the UI can say "no safe fix found".
- **Mock mode** (`READBACK_MOCK_AI=1` or no API key): deterministic canned readers derived from regex cues, so the demo works offline. `summary.mode = "mock"` and the UI shows a banner.
- Content-hash cache: an in-memory LRU keyed on the hash of text + image + brand facts version.

### Data layer: `src/lib/db/`
`server.ts`: `createClient()` (cookies, RLS as the user) and `createAdmin()` (service role, server only).
`queries.ts` exports **exactly** these (all server-side; RLS enforced through the user client):
```ts
getSessionUser(): Promise<{ id: string; name: string; role: Role; email: string } | null>
getBrand(): Promise<BrandSpace>                       // the single brand for the user (Velura)
listSubmissions(filter?: { status?: SubmissionStatus }): Promise<Submission[]>  // agency only sees own (RLS)
getSubmission(id: string): Promise<{ submission: Submission; versions: Version[]; comments: Comment[]; audit: AuditEntry[] } | null>
createSubmission(input: { title; channel; lang; intent; body; lockedPhrases: string[]; image?: { data: Buffer; mime: string; alt: string | null } }): Promise<{ submissionId: string; versionId: string }>
addVersion(submissionId: string, input: { body: string; image_path?: string | null; image_alt?: string | null }): Promise<string>
saveCheckResult(versionId: string, findings: Finding[], summary: CheckSummary): Promise<void>
updateFinding(versionId: string, findingId: string, patch: Partial<Pick<Finding,"status"|"dispute_note">>): Promise<void>
addComment(submissionId: string, versionN: number, body: string, anchor: Span | null): Promise<void>
setStatus(submissionId: string, status: SubmissionStatus, note?: string): Promise<void> // writes audit with fact versions cited
recordPublishedUrl(submissionId: string, url: string): Promise<void>
upsertFact(f: Partial<Fact> & { statement: string }): Promise<void> // bumps version, re-embeds, writes audit, enqueues recall
upsertClause / upsertTerm / deleteTerm / updateBrand(voice_traits, palette) / upsertPersona
importGuidelineClauses(clauses: Omit<Clause,"id">[]): Promise<void>
listRecallQueue(): Promise<{ submission: Submission; fact_code: string; reason: string; url: string | null }[]>
getInsights(): Promise<{ topClauses: {code:string;title:string;count:number}[]; byAuthor: {name:string;role:Role;findings:number;high:number}[]; unclear: {code:string;title:string;disputeRate:number;splitCount:number}[]; staleFacts: Fact[] }>
signedImageUrl(path: string): Promise<string | null>
matchFacts(embedding: number[], k: number): Promise<{ fact: Fact; similarity: number }[]>
```
Tables: `profiles(id→auth.users, name, role, org)`, `brands`, `clauses`, `facts(+embedding vector(768))`, `terms`, `personas`, `submissions`, `versions(findings jsonb, summary jsonb)`, `comments`, `fact_citations(submission_id, fact_code, fact_version)`, `audit_log` (insert-only: a trigger blocks UPDATE and DELETE; `hash = sha256(prev_hash || row)`).
RLS: owner, reviewer, and creator see everything for their brand; agency sees only `submissions.author_id = auth.uid()` and the facts, terms, and clauses (read-only). Only the owner writes Brand Space. Only the reviewer and owner can approve.
Seed (`scripts/seed.ts`, run with `pnpm seed`): Velura brand, 4 demo users (owner@velura.demo Priya Owner; creator@velura.demo Arjun Creator; reviewer@velura.demo Meera Legal; agency@bloomagency.demo Bloom Agency), about 14 clauses, about 15 facts (including F-03 "Dermatologist-tested", F-07 "71% saw more radiant skin at week 4", F-12 "92% naturally derived ingredients (ISO 16128)", one expiring soon, one expired), terms (banned "zero chemicals" → "92% naturally derived ingredients", "chemical-free", "guaranteed", "clinically proven" unless cited, "miracle"; preferred "skin-loving" etc.; disclaimers "*Results may vary" triggered by "results|visible|% saw"; embargo "Velura Nightshift" unreleased product), palette (5 colours), voice traits, 3 personas (Urban working woman 25–34, College student on a budget, Skin-concern-focused 35+), and 8 submissions across all statuses with their findings precomputed (so Insights and Recall have data with no AI calls). Also generate `public/demo/velura-142.png` with sharp (lab-coat-white and leaf-green blocks, low-contrast overlay text "Visible glow in 7 days") so the demo image ships with the repo.

### UI: `src/app/`
Routes:
- `/`: landing with one sentence on what Readback does and 4 large "Enter as …" role buttons (server action → `signInWithPassword` with the seeded user), plus a small email login. The AI disclosure lives here and in the footer.
- `/app`: inbox of submissions, filterable by status. Role switcher in the top bar.
- `/app/new`: submit a draft: text, image upload + alt, channel, language, intended takeaway, locked phrases. A **"Load Velura #142 example"** button prefills everything.
- `/app/s/[id]`: the **review screen** (the core). Left: the draft with highlighted spans (colour plus an underline style per category; never colour alone). Middle: findings list grouped [RULE] / [AI], each showing explanation, citation chip, belief meter "5 of 6 readers", verdict badge, and the suggestion with its re-read result, plus actions Accept / Edit / Dispute (with a note). Right: the reader panel (6 cards filling in live from the NDJSON stream) and the comments thread. Top: version tabs v1/v2… with a word diff toggle, status pill, and Approve / Request changes (reviewer and owner only), plus "Record published URL" once approved. Accepting suggestions and then "Save as v2" creates a new version and reruns the check.
- `/app/brand`: tabs for Clauses (with PDF/DOCX/TXT guideline import → split into numbered clauses → confirm), Fact Ledger (expiry, version, source), Terms, Palette & voice, Personas (warn when a description uses protected attributes).
- `/app/recall`: Recall Queue.
- `/app/insights`: most-broken clauses, findings by author, unclear clauses (high dispute rate or 50/50 splits), stale facts. Simple hand-made bar charts, no chart library.
- `/app/audit`: hash-chained audit log with a "verify chain" button.
- `POST /api/check` `{ versionId }` → NDJSON stream of `CheckEvent`; it persists through `saveCheckResult` at the end.

## Design direction: "proof desk"
Editorial and calm, like a newsroom copy desk marking up a proof. It must **not** look like a generic AI/shadcn template.
- Paper `#F7F4EE` background, ink `#1B1A17` text, rules/borders `#E3DDD1`, muted `#6B655B`.
- Accent **proof red** `#B3261E` for high-severity findings. Amber `#9A6700` medium, slate `#3D5A80` low/info, green `#2F6B3F` supported/approved.
- Type: **Newsreader** (Google Fonts, via next/font) for display and headings, **Inter Tight** for UI, **JetBrains Mono** for codes like G-12, F-07, and hashes.
- Thin 1px rules, no drop shadows, no gradients, 4–6px radius, generous whitespace but dense data tables. No emoji. Icons from lucide at 16px, used sparingly.
- Highlights in the draft look like proof marks: a wavy underline in the category colour plus a light tint, with a small superscript finding number.
- Dark mode is not required. Hit WCAG 2.2 AA: focus rings, keyboard reachability, and labels on meters.
- Copy voice: plain, specific, no hype. "5 of 6 readers believed results are guaranteed in a week," not "AI detected issues!"
