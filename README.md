# Readback

**Pre-publication brand and claim governance.** Readback checks a marketing draft before it ships. It runs two engines over the same draft:

- A **Rule Engine** of exact, deterministic checks.
- An **Impression Engine** with six simulated readers. Each reports what they *believe* after reading the copy and seeing the image.

Every belief must be traced to the words or image element that caused it. It is then checked against the brand's Fact Ledger, and any suggested fix is re-read by the panel before anyone sees it.

Built by Team Nova (Rishabh Kataria, solo) for the Inkloom AI brand-governance problem statement at the We Code Coders hackathon, Round 2.

> Demo brand: **Velura**, a fictional Indian skincare D2C label. All brand data, people and submissions in the demo are fictional.

---

## Try it

1. Open the deployed app and click **Try it as a creator** (or any **Enter as…** role). No sign-up is needed. A short guided tour starts on first visit; reopen it with **Tour** in the top bar. Each role sees and can do different things, enforced by Postgres row-level security and workflow triggers.
2. Open **#142 Hero post: Vitamin C serum**. It has precomputed results, so you can explore the full review screen without waiting for AI calls.
3. Go to **New draft** → **Fill in the demo draft** → **Save and run check** to watch a live check stream in (rule findings appear at once; the six readers take one to two minutes on the free Gemini tier).
4. Accept a fix and **Save as v2**, then **Send for review**. Switch to **Reviewer** (top-right menu), approve, and **Record published URL**. Then open **Audit log** → **Verify chain**.
5. As **Brand owner**, edit a fact in **Brand Space → Approved facts**. Every approved or published post that cited it appears in the **Recall queue**.
6. Open **Compare translations** → **Load Velura example** → **Compare translation**. The Hindi line adds पक्का ("guaranteed") and is flagged **Made stronger** under clause G-13; the dropped disclaimer is flagged too.

## What works (Round 2)

| Area | Status |
|---|---|
| One-click demo roles (owner, creator, reviewer, agency) with RLS | ✅ |
| Brand Space: clauses (with guideline PDF/DOCX/TXT import and clause confirmation), Fact Ledger with versions and expiry, banned/preferred/disclaimer/embargo terms, palette and voice, personas | ✅ |
| Privacy Gate: emails, Indian phone numbers, PAN, Aadhaar (spaced or not), card numbers (Luhn-checked) and embargoed names are masked into tokens before any model or embedding call | ✅ |
| Rule Engine: hand-written Aho-Corasick term matching, missing disclaimers, embargo leaks, WCAG 1.4.3 contrast measured from image pixels, WCAG 1.1.1 alt text, off-palette colours by ΔE2000 | ✅ |
| Impression Engine: 6 readers (3 brand personas + literal buyer, Hindi/Hinglish reader, ASCI sceptic), quote and visual grounding, belief grouping (≥2 of 6 readers), Fact Ledger verdicts, tone check | ✅ |
| Span-level fixes with a re-read gate and locked phrases | ✅ (needs Gemini capacity, see limitations) |
| Review workflow: accept / edit / dispute per finding, versions with word diffs, inline comments, approve / request changes, record published URL | ✅ |
| Hash-chained, insert-only audit log with chain verification | ✅ |
| Workflow rules enforced in Postgres as well as the app: allowed status changes only, no self-approval, saved versions immutable, a new version sends reviewed content back to draft | ✅ |
| First-visit guided tour (inbox and review screen), instant role switcher, WCAG 2.2 AA pass on contrast, focus and announcements | ✅ |
| Bring your own Gemini key: a top-bar badge shows whether checks run on the shared free key or your own; your key is checked with Google, kept only in your browser and sent with your own AI requests (never stored or logged on the server) | ✅ |
| Recall Queue for stale or changed facts, Insights (most-broken clauses, findings by author, unclear clauses from disputes and 50/50 reader splits, stale facts) | ✅ |
| Cross-language belief diff: English master vs Hindi/Hinglish, NEW BELIEF / STRENGTHENED CLAIM labels | ✅ v1 |
| ASCI-Bench: 100 public ASCI rulings plus a CLI runner comparing Readback with a single-prompt baseline | ✅ v1 |

## The three named improvements

These are the three improvements named in the Round 1 plan. Each has a working first version in Round 2 and a stated Round 3 target.

| # | Improvement | Round 2 state (in this repo) | Round 3 target |
|---|---|---|---|
| 1 | **ASCI-Bench** | [`data/asci-bench.json`](data/asci-bench.json) has 100 real rulings (66 upheld, 34 not upheld). [`scripts/asci-bench.ts`](scripts/asci-bench.ts) (`pnpm bench`) runs Readback and a single-prompt baseline on a stratified slice and reports recall on upheld rulings, the false-alarm rate on not-upheld rulings, and run-to-run stability. Results go to `data/asci-bench-results.json`. | Full 100-case runs with three repeats, hand-checked ground labels, per-ground breakdown, and an advertiser-evidence ledger so not-upheld cases are judged against the evidence ASCI accepted. |
| 2 | **Cross-language consistency** | [`src/lib/ai/drift.ts`](src/lib/ai/drift.ts), [`/api/drift`](src/app/api/drift/route.ts) and the **Compare** page ([`CompareForm.tsx`](src/components/CompareForm.tsx)). The panel reads both versions in one call and pairs beliefs; code labels each pair NEW BELIEF, STRENGTHENED CLAIM, weakened, dropped or same, citing clause G-13. | Link variants to their master submission so drift findings join the review workflow and audit log; marketplace-listing variants; more Indic languages. |
| 3 | **Fact Recall** | `fact_citations` records the fact versions every approval relied on. Editing or expiring a fact puts each approved or published post that cited it into the Recall Queue with its live URL ([`listRecallQueue`](src/lib/db/queries.ts)). | Scheduled re-checks of the live URLs (Amazon, Nykaa, website) to confirm the stale claim was actually removed, plus expiry alerts before a fact lapses. |

## ASCI-Bench v1 results (Round 2)

`pnpm bench` on a stratified 20-case slice of real ASCI rulings (13 upheld, 7 not upheld), live Gemini, 23 Oct 2026. Raw per-case output is in [`data/asci-bench-results.json`](data/asci-bench-results.json).

| Metric | Readback | Single-prompt baseline |
|---|---|---|
| Recall on upheld rulings | **84.6%** (11/13) | 76.9% (10/13) |
| False alarms on not-upheld rulings | **42.9%** (3/7) | 57.1% (4/7) |
| Run-to-run stability (5 cases × 3 runs) | 80.0% | not measured |

With n = 20 these numbers are directional, not statistically significant. The false-alarm rate is an upper bound because the benchmark brand has no Fact Ledger: Readback cannot see the evidence advertisers gave ASCI. Closing that gap is the Round 3 target for improvement 1.

## Architecture

```
Browser (Next.js App Router, React 19)
  │  NDJSON stream: rules → reader cards → findings → suggestions → summary
  ▼
POST /api/check ─── Supabase Auth + role check (RLS)
  │
  ├─ Privacy Gate        src/lib/privacy/gate.ts   mask → ⟦EMAIL_1⟧, ⟦EMBARGO_1⟧ … unmask on return
  ├─ Rule Engine         src/lib/rules/            plain code, no tokens, ~100 ms
  │    aho-corasick.ts · color.ts (WCAG, ΔE2000) · pixels.ts (sharp k-means on text boxes)
  └─ Impression Engine   src/lib/ai/               Gemini via Vercel AI SDK + zod schemas
       vision (text boxes) → panel (6 readers, 1 call) → grounding → embeddings + clustering
       → fact judge (+ visual confirmation) → span fixes → one combined re-read gate
  ▼
Supabase Postgres + pgvector + private Storage
  brands · clauses · facts(embedding vector(768)) · terms · personas · submissions · versions
  comments · fact_citations · audit_log (insert-only, sha256 hash chain via trigger)
```

### Main technical decisions

- **Two engines, not one prompt.** Anything that can be decided exactly (terms, disclaimers, contrast ratios, colour distance) is plain code, so it's fast, free and reproducible. The model is only used for what requires reading comprehension: implied claims, tone, and cross-modal impressions.
- **No citation, no flag.** A reader's belief must quote an exact substring of the draft (fuzzy-normalised) or name a visual element that a separate vision check confirms. Ungrounded beliefs are dropped before anyone sees them. A belief becomes a finding only when at least 2 of 6 readers form it independently. A 40–60% split is reported as *ambiguous* wording rather than a violation.
- **"Unsupported", never "false".** Beliefs are matched to the closest Fact Ledger entries (pgvector `match_facts`) and judged *supported*, *contradicted* or *unsupported*. If no fact matches, the result says so.
- **Fixes have to pass a re-read.** A fix rewrites only the trigger span and never touches locked phrases. It's shown as safe only if the re-read panel no longer holds the flagged belief, no new unsupported belief appears, and most readers still get the creator's declared intent.
- **Built for a free-tier quota.** Gemini's free tier allows 5 requests per minute per model, so a check makes at most 6 generation calls (the six readers share one structured call). Calls rotate across several Gemini models, with per-model cooldowns parsed from 429/503 responses, plus a per-check time budget. When the AI is unavailable, the rule findings are still saved and the UI says why.
- **Tamper-evident decisions.** `audit_log` rejects UPDATE/DELETE/TRUNCATE. Each row stores `sha256(prev_hash || row)` and the exact fact versions an approval relied on.
- **One language, one repo.** Everything is TypeScript, so a solo builder can own it end to end.

## Tech, models and services

| Kind | Used |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Database / auth / storage | Supabase (Postgres 15, Auth, Storage, pgvector, row-level security) |
| AI SDK | Vercel AI SDK v4 (`ai`, `@ai-sdk/google`), zod v3 |
| Models (external service) | Google Gemini: `gemini-3.8-flash`, with `gemini-3.5-flash`, `gemini-flash-latest` and `gemini-3.1-flash-lite` as rotation fallbacks; embeddings from `gemini-embedding-001` (768 dims) |
| Libraries | sharp (pixels), diff (word diffs), mammoth (DOCX), unpdf (PDF), lucide-react (icons), clsx |
| Fonts | Newsreader, Inter Tight, JetBrains Mono (Google Fonts via `next/font`) |
| Testing | Vitest (52 unit tests: Aho-Corasick, contrast, ΔE2000, masking, grounding, clustering, drift labelling, mock pipeline); ASCI-Bench CLI |
| Data | ASCI Complaint Outcomes (public rulings) for ASCI-Bench; see [`data/asci-bench.README.md`](data/asci-bench.README.md) |
| Hosting | Vercel |

## Run locally

```bash
pnpm install
cp .env.example .env.local     # fill in Supabase + Gemini keys and a DEMO_PASSWORD
# run supabase/migrations/0001_init.sql, then 0002_hardening.sql, in the Supabase SQL editor (see supabase/README.md)
pnpm seed                      # demo brand, users, submissions, embeddings
pnpm dev                       # http://localhost:3000
pnpm test                      # unit tests
pnpm bench                     # ASCI-Bench on 20 cases (--limit 100, --stability 0, --mock, --fresh)
```

Set `READBACK_MOCK_AI=1` to run with deterministic mock readers and no API key.

## Privacy, security and responsible design

- **What leaves the server:** draft text and image go to Google Gemini, but only after the Privacy Gate replaces emails, phone numbers, PAN, Aadhaar and embargoed product names with tokens. Fact statements sent for embedding pass through the same gate. This is disclosed on the landing page and in the app footer.
- **Access control:** row-level security in Postgres, plus triggers that enforce the review workflow for anyone calling the database directly (allowed status changes only, no self-approval, immutable versions, image-only uploads up to 8 MB). Agencies see only their own submissions. Only the brand owner edits Brand Space. Only reviewers and the owner approve. Images live in a private bucket served through short-lived signed URLs. The service-role key is used only on the server.
- **Prompt-injection hardening:** draft text is fenced in prompts and cannot close its fence; a belief only counts if it quotes the draft or a visual element confirmed in the image, so injected text cannot invent or hide findings on its own.
- **Human control:** Readback never edits content automatically, never publishes, and never blocks a human override. Every finding is labelled `[RULE]` or `[AI]` with the model name and the cited clause, fact or WCAG criterion. Disputes are recorded with a note.
- **Limits of AI personas:** simulated readers don't represent real populations. The panel is a comprehension stress test, kept honest by grounding, multi-reader agreement and human sign-off.

## Known limitations

- **Live AI on the shared free key is slow and can fail** (add your own key from the top-bar badge to avoid this). On a free Gemini key a live check takes one to three minutes, and when Google returns 503 "high demand" it may save only rule findings (the page then says "Partial check"). Checks keep running and save even if you leave the page. The seeded submissions always show complete results.
- **Demo sign-in is open by design.** Anyone with the link can enter any role so judges need no account; in production this would be real sign-in with invited users.
- **Reader cards don't persist.** They appear only during a live run. Findings and summaries are saved.
- **ASCI-Bench is a small first run.** On the free Gemini tier a full 100-case run takes hours and can hit the daily quota, so the Round 2 numbers above come from a 20-case stratified slice. The benchmark brand has an empty Fact Ledger, so the false-alarm rate is an upper bound. The dataset's `grounds` tags were assigned by keyword rules and need hand review.
- **Drift comparisons are not stored.** The Compare page is a standalone check; linking variants to submissions is Round 3 work.
- **Single brand.** The demo workspace is one brand (Velura).

## Disclosures

- **Boilerplate:** the first commit is the unmodified `create-next-app` template (Next.js 15, TypeScript, Tailwind). It was entirely replaced in later commits.
- **AI assistance:** substantial parts of the code, the seed content and the ASCI-Bench dataset collection were produced with AI coding assistance (Anthropic Claude, via Claude Code), directed, reviewed, tested and integrated by the participant. The product design and architecture follow the participant's Round 1 proposal.
- **External services:** Google Gemini API (generation and embeddings), Supabase, Vercel.
- **Data:** ASCI rulings are public records from ascionline.in, cited per record. "Velura" and all demo people and products are fictional.

## Team

Team Nova: **Rishabh Kataria** (solo). Product, research, AI engine, full-stack app, rule engine, testing and presentation (100%).
