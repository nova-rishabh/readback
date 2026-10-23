# Readback

**Pre-publication brand and claim governance.** Readback checks a marketing draft before it ships. It runs two engines over the same draft:

- A **Rule Engine** of exact, deterministic checks.
- An **Impression Engine** with six simulated readers. Each reports what they *believe* after reading the copy and seeing the image.

Every belief must be traced to the words or image element that caused it. It is then checked against the brand's Fact Ledger, and any suggested fix is re-read by the panel before anyone sees it.

Built by Team Nova (Rishabh Kataria, solo) for the Inkloom AI brand-governance problem statement at the We Code Coders hackathon, Round 2.

> Demo brand: **Velura**, a fictional Indian skincare D2C label. All brand data, people and submissions in the demo are fictional.

---

## Try it

1. Open the deployed app and click **Enter as creator**, **reviewer**, **brand owner** or **agency**. No sign-up is needed. Each role sees and can do different things, enforced by Postgres row-level security.
2. Open **#142 Hero post: Vitamin C serum**. It has precomputed results, so you can explore the full review screen without waiting for AI calls.
3. Go to **New draft** → **Load Velura #142 example** → **Save and run check** to watch a live check stream in.
4. Switch to **Reviewer** (top-right menu) and approve or request changes. Then open **Audit log** → **Verify chain**.
5. As **Brand owner**, edit a fact in **Brand Space → Fact Ledger**. Every approved or published post that cited it appears in the **Recall queue**.

## What works (Round 2)

| Area | Status |
|---|---|
| One-click demo roles (owner, creator, reviewer, agency) with RLS | ✅ |
| Brand Space: clauses (with guideline PDF/DOCX/TXT import and clause confirmation), Fact Ledger with versions and expiry, banned/preferred/disclaimer/embargo terms, palette and voice, personas | ✅ |
| Privacy Gate: emails, Indian phone numbers, PAN, Aadhaar and embargoed names are masked into tokens before any model call | ✅ |
| Rule Engine: hand-written Aho-Corasick term matching, missing disclaimers, embargo leaks, WCAG 1.4.3 contrast measured from image pixels, WCAG 1.1.1 alt text, off-palette colours by ΔE2000 | ✅ |
| Impression Engine: 6 readers (3 brand personas + literal buyer, Hindi/Hinglish reader, ASCI sceptic), quote and visual grounding, belief grouping (≥2 of 6 readers), Fact Ledger verdicts, tone check | ✅ |
| Span-level fixes with a re-read gate and locked phrases | ✅ (needs Gemini capacity, see limitations) |
| Review workflow: accept / edit / dispute per finding, versions with word diffs, inline comments, approve / request changes, record published URL | ✅ |
| Hash-chained, insert-only audit log with chain verification | ✅ |
| Recall Queue for stale or changed facts, Insights (most-broken clauses, findings by author, unclear clauses, stale facts) | ✅ |
| ASCI-Bench v1 dataset: 100 public ASCI rulings in [`data/asci-bench.json`](data/asci-bench.json) | ✅ dataset; ⏳ scoring runner |

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
| Testing | Vitest (46 unit tests: Aho-Corasick, contrast, ΔE2000, masking, grounding, clustering, mock pipeline) |
| Data | ASCI Complaint Outcomes (public rulings) for ASCI-Bench; see [`data/asci-bench.README.md`](data/asci-bench.README.md) |
| Hosting | Vercel |

## Run locally

```bash
pnpm install
cp .env.example .env.local     # fill in Supabase + Gemini keys and a DEMO_PASSWORD
# run supabase/migrations/0001_init.sql in the Supabase SQL editor (see supabase/README.md)
pnpm seed                      # demo brand, users, submissions, embeddings
pnpm dev                       # http://localhost:3000
pnpm test                      # unit tests
```

Set `READBACK_MOCK_AI=1` to run with deterministic mock readers and no API key.

## Privacy, security and responsible design

- **What leaves the server:** draft text and image go to Google Gemini, but only after the Privacy Gate replaces emails, phone numbers, PAN, Aadhaar and embargoed product names with tokens. Fact statements are sent for embedding. This is disclosed on the landing page and in the app footer.
- **Access control:** row-level security in Postgres. Agencies see only their own submissions. Only the brand owner edits Brand Space. Only reviewers and the owner approve. Images live in a private bucket served through short-lived signed URLs. The service-role key is used only on the server.
- **Human control:** Readback never edits content automatically, never publishes, and never blocks a human override. Every finding is labelled `[RULE]` or `[AI]` with the model name and the cited clause, fact or WCAG criterion. Disputes are recorded with a note.
- **Limits of AI personas:** simulated readers don't represent real populations. The panel is a comprehension stress test, kept honest by grounding, multi-reader agreement and human sign-off.

## Known limitations

- **Live AI on the free tier is slow and can fail.** On a free Gemini key a live check can take 30–120 s, and when Google returns 503 "high demand" it may save only rule findings. The seeded submissions always show complete results.
- **Reader cards don't persist.** They appear only during a live run. Findings and summaries are saved.
- **ASCI-Bench scoring isn't run yet.** The dataset (100 rulings, 66 upheld / 34 not upheld) is in the repo; the scoring runner and baseline comparison are Round 3 work. Its `grounds` tags were assigned by keyword rules and need hand review.
- **Single brand.** The demo workspace is one brand (Velura).

## Disclosures

- **Boilerplate:** the first commit is the unmodified `create-next-app` template (Next.js 15, TypeScript, Tailwind). It was entirely replaced in later commits.
- **AI assistance:** substantial parts of the code, the seed content and the ASCI-Bench dataset collection were produced with AI coding assistance (Anthropic Claude, via Claude Code), directed, reviewed, tested and integrated by the participant. The product design and architecture follow the participant's Round 1 proposal.
- **External services:** Google Gemini API (generation and embeddings), Supabase, Vercel.
- **Data:** ASCI rulings are public records from ascionline.in, cited per record. "Velura" and all demo people and products are fictional.

## Team

Team Nova: **Rishabh Kataria** (solo). Product, research, AI engine, full-stack app, rule engine, testing and presentation (100%).
