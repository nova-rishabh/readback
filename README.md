# Readback

**Pre-publication brand and claim governance.** Readback checks a marketing draft before it ships, and keeps checking
it after it goes live. Two engines read every draft:

- A **Rule Engine** of exact, deterministic checks (terms, disclaimers, embargoes, contrast from pixels, alt text, palette).
- An **Impression Engine**: six simulated readers say what they *believe* after reading the copy and seeing the image.
  Every belief must quote the words (or point to the image element) that caused it, is checked against the brand's
  Fact Ledger, and any suggested fix is re-read by the panel before anyone sees it.

**Live app:** https://readback-virid.vercel.app · **Source:** https://github.com/nova-rishabh/readback ·
Team Nova (Rishabh Kataria, solo) · Inkloom AI brand-governance problem statement, We Code Coders hackathon.

> Demo brand: **Velura**, a fictional Indian skincare D2C label. All brand data, people and submissions are fictional.

---

## Try it in ten minutes (no sign-up)

Open the live app and press **Try it as a creator**. A short tour starts on first visit; reopen it with **Tour** in the
top bar. Switch seats any time from the menu at the top right (creator, reviewer, brand owner, agency).

| # | Journey | Where | What you should see |
|---|---|---|---|
| 1 | **A full check, saved** | Inbox → **#142 Hero post** (marked *Start here*) | Rule and AI findings marked in the draft, the six readers' takeaways, citations to clauses, facts and WCAG. Accept a fix → **Save as v2** runs a live check (about 30 seconds to 3 minutes on the free Gemini key, depending on load). |
| 2 | **Your own draft** | **New draft** → **Fill in the demo draft** (or **Import from DOCX, PDF or TXT** with the sample DOCX) → **Save and run check** | Rule findings at once, readers stream in, findings save as they arrive; leaving the page does not stop the check. |
| 3 | **Review workflow** | As creator: **Send v2 for review**. Switch to **Reviewer**: **Approve** (or Request changes with a note), then **Record published URL** | Status moves draft → in review → approved → published; you cannot approve your own draft; every step lands in the hash-chained audit log (**Audit log → Verify chain**). |
| 4 | **Translations** (improvement 2) | Open **#146** (Hindi version of **#145**), or open #145 → **Add a translation** → **Fill in a sample Hindi translation** | The English master and the translation side by side, belief by belief. पक्का (“guaranteed”) is flagged as a claim the translation added, cited to clause G-13, with suggested wording that passed a re-comparison. Tamil (#147) and Marathi translations get a native reader. |
| 5 | **Live fact recall** (improvement 3) | As **brand owner**: **Recall** in the top bar → #139 → **Check live page now** | Readback opens the post's live page and finds the stale “#1 rated” claim. Open the live page, **Edit this demo page**, remove the line, check again: the recall closes itself and the audit log records it. Expiry alerts list facts lapsing within 30 days. |
| 6 | **Fact change → recall** | As brand owner: **Brand** (Brand Space) → **Approved facts** → edit a fact cited by an approved post | Every approved or published post that relied on it joins the Recall queue, and its live page is re-checked straight away. |
| 7 | **The benchmark** (improvement 1) | **Benchmark** in the top bar | ASCI-Bench on 100 real Advertising Standards Council of India rulings, three runs each, against a single-prompt baseline, with and without the evidence ASCI accepted; every case is inspectable. |

The demo is shared. The brand owner can put the seeded drafts back with **Brand → Reset demo drafts**, and the
daily job does it every morning (09:00 IST); drafts you create are kept. If the shared free Gemini key is busy, add your
own free key from the **Free Gemini key** badge in the top bar; it stays in your browser.

---

## What Round 3 added

### The three improvements named in Round 2

| # | Improvement | Delivered |
|---|---|---|
| 1 | **ASCI-Bench at full scale with evidence-aware scoring** | All **100** rulings, **3 runs each** (majority verdict, run-to-run stability), a single-prompt baseline, Wilson 95% intervals, **per-ground** and per-category breakdowns. Grounds re-labelled from each ruling's full text (unsubstantiated, exaggeration, implication, omission, comparison, statutory). An **advertiser-evidence ledger** ([`data/asci-evidence.json`](data/asci-evidence.json)) records what each advertiser submitted and what the panel accepted; `pnpm bench --ledger` gives each case's brand that accepted evidence as its Fact Ledger. Results page in the app: **/app/bench**. |
| 2 | **Cross-language consistency inside the review workflow** | A Hindi, Hinglish, Tamil or Marathi draft can be **linked to its English master**. Every check of every version compares the beliefs each leaves (one structured call), and anything the translation adds or makes stronger becomes a **finding** (clause G-13) that is accepted, edited or disputed and approved like any other, and recorded in the audit log. Suggested wording must pass a **re-comparison** with the master. **Tamil and Marathi native readers** join the panel for those languages. The master lists its translations and their open drift. |
| 3 | **Live Fact Recall** | When a cited fact changes or expires, Readback **fetches each post's live URL** (SSRF-guarded), looks for the approved wording that relied on the fact, and **closes the recall automatically** when it is gone, with an audit entry. Checks run on demand, **when a fact is edited**, and **daily** (Vercel Cron). **Expiry alerts** list facts lapsing within 30 days and the posts that cite them; the daily job marks lapsed facts expired and records one alert per fact. A demo storefront stands in for real product pages so the whole loop can be tried. |

### Loose ends closed

- **Drafts from documents:** import a DOCX, PDF or TXT into New draft; a DOCX's first image is attached; the source file is recorded in the audit log.
- **Compare translations** results are now kept when the translation is linked to its master (the Compare page stays as a quick, unsaved check).
- **Demo data changed by other visitors:** owner reset and a daily automatic reset of the seeded drafts.

### Reliability fixes found by testing

- **Stable verdicts.** A first full benchmark pass showed only 52% of cases got the same verdict on all three runs: readers paraphrase one claim many ways and embedding similarity split them. Beliefs anchored on the **same quoted words and category** now group together (and the panel runs at temperature 0); the same unstable cases became stable on every run. The pre-fix run is kept in [`data/asci-bench-results-v3.0-before-grouping-fix.json`](data/asci-bench-results-v3.0-before-grouping-fix.json).
- **Embedding quota no longer ends a check.** The free tier allows 1,000 embedding requests per model per day. Checks now rotate `gemini-embedding-001` → `gemini-embedding-2` → `gemini-embedding-2-preview` (matching facts in memory outside the stored vector space) and finally fall back to word-overlap grouping with a visible note. Daily-quota retry hints (“retry in 22h12m…”) are parsed so exhausted models are skipped.
- **Workflow buttons match the rules:** reviewers only see Approve on drafts that were sent for review, and never on their own.
- **Medical claims never slip through.** “Cures acne”, “treats eczema” and similar disease claims are a rule, caught by code on every draft even when the AI is busy (found by an independent judge-style review; see [docs/TESTING.md](docs/TESTING.md)).
- **Translations that drop a disclaimer** raise a finding, and **approving after a partial AI check** requires an explicit acknowledgment recorded in the audit log.
- **Bad links are “not found”,** not a database error. Hindi, Tamil and Marathi quotes keep their vowel signs when located in the draft.

---

## ASCI-Bench: Round 3 results

The full 100-case run (three runs per case, with and without the evidence ASCI accepted) is in progress; the final
numbers will replace this note. On the first 36 upheld rulings with the final engine, Readback flagged 35 (97.2%)
against 28 (77.8%) for the single-prompt baseline, and every case gave the same verdict on all three runs. Every case,
with intervals and the per-ground breakdown, is on **/app/bench**.

---

## Complete feature list

**Workspace and roles**
- One-click demo roles (brand owner, creator, reviewer, agency), no sign-up; email and password sign-in also available.
- Row-level security in Postgres: agencies see only their own drafts; only the owner edits Brand Space; only reviewers and the owner approve.
- Guided first-visit tour on the inbox and review screen; Tour button to reopen it.
- Bring your own Gemini key (verified with Google, kept only in the browser, used only for your requests).
- Owner reset of the seeded demo, plus a daily automatic reset.

**Brand Space**
- Guideline clauses, with PDF/DOCX/TXT import and clause-by-clause confirmation.
- Fact Ledger: approved facts with source, owner, versions and expiry dates; pgvector embeddings.
- Banned and preferred terms, required disclaimers with triggers, embargoed product names.
- Brand palette and voice traits; reader personas (three brand personas plus built-in readers).

**Drafts**
- Copy, image with alt text, channel, language (English, Hindi, Hinglish, Tamil, Marathi), intended takeaway, phrases fixes must keep.
- Import copy from DOCX, PDF or TXT (and a DOCX's first image).
- Translations linked to an English master.

**Checks**
- Privacy Gate: emails, Indian phone numbers, PAN, Aadhaar, card numbers (Luhn-checked) and embargoed names become tokens before any AI call.
- Rule Engine: Aho-Corasick term matching tied to clauses, missing disclaimers, embargo leaks, WCAG 1.4.3 contrast measured from pixels inside the text boxes the vision model finds, WCAG 1.1.1 alt text, off-palette colours by ΔE2000.
- Impression Engine: six readers in one structured call; quote and visual grounding; beliefs grouped across readers (2 of 6 needed); verdicts against the Fact Ledger (supported, contradicted, unsupported, ambiguous); tone against the brand voice.
- Translation drift against the master, with gated suggested wording.
- Span-level fixes that change only the flagged words, never locked phrases, shown as safe only after a re-read.
- Live streaming review screen; results checkpointed as they arrive; checks survive navigation and reloads; partial checks say why.
- Quota-aware Gemini model rotation (generation and embeddings) with cooldowns and a per-check time budget.

**Review and governance**
- Accept, edit or dispute each finding; versions with word diffs; anchored comments; send for review; approve or request changes; record the published URL.
- Workflow enforced in the database too: allowed status changes only, no self-approval, saved versions immutable, a new version sends reviewed content back to draft.
- Tamper-evident audit log: insert-only, SHA-256 hash chain, Verify chain button; approvals store the fact versions they relied on.
- Recall queue with live-page checks, automatic and manual closure, and expiry alerts; daily scheduled sweep.
- Insights: rules broken most often, findings by author, unclear rules (disputes and 50/50 reader splits), facts about to expire.
- Compare translations: a quick, unsaved comparison of any two versions.

**Evaluation**
- ASCI-Bench: 100 real rulings, evidence ledger, CLI runner, in-app results page with every case.
- 72 unit tests (Vitest), a migration test in an in-memory Postgres, and logged end-to-end journeys ([docs/TESTING.md](docs/TESTING.md)).

---

## Architecture

```
Browser (Next.js App Router, React 19)
  │  NDJSON stream: rules → reader cards → findings → drift → suggestions → summary
  ▼
POST /api/check ─── Supabase Auth + role (RLS) ─── job runs under after(): survives navigation
  │
  ├─ Privacy Gate        src/lib/privacy/gate.ts     mask → ⟦EMAIL_1⟧, ⟦EMBARGO_1⟧ … unmask on return
  ├─ Rule Engine         src/lib/rules/              plain code, no tokens
  │    aho-corasick.ts · color.ts (WCAG, ΔE2000) · pixels.ts (sharp k-means on text boxes)
  └─ Impression Engine   src/lib/ai/                 Gemini via Vercel AI SDK + zod schemas
       vision (text boxes) → panel (6 readers, 1 call) → grounding → embeddings + anchored grouping
       → fact judge → [translations: drift vs master + gated wording] → span fixes → combined re-read gate
  ▼
Supabase Postgres + pgvector + private Storage
  brands · clauses · facts(vector 768) · terms · personas · submissions(master_id) · versions(findings, summary)
  comments · fact_citations · live_pages · audit_log (insert-only, sha256 chain via trigger)

Live Fact Recall   src/lib/recall/   queue derived from fact_citations + audit_log; live.ts fetches pages safely
  ├─ on demand (Recall queue) · on fact edit (after()) · daily (Vercel Cron → /api/cron/recall)
  └─ outcomes → audit_log: recall_url_checked, recall_closed, fact_expired, fact_expiry_alert

ASCI-Bench         scripts/asci-bench.ts → data/*.json → src/lib/bench/metrics.ts → /app/bench
```

### Main technical decisions

- **Two engines, not one prompt.** Anything decidable exactly (terms, disclaimers, contrast ratios, colour distance) is code: fast, free, reproducible. The model handles only reading comprehension: implied claims, tone, cross-modal impressions, translation drift.
- **No citation, no flag.** A belief must quote the draft (fuzzy-normalised, Unicode-aware) or name an image element a separate vision check confirms. A belief becomes a finding only when 2 of 6 readers form it; a 40–60% split is reported as ambiguous wording.
- **Group by what triggered the belief.** Readers word one claim many ways. Beliefs of the same category anchored on the same quoted words join one group even when their embeddings differ, which made repeat checks agree.
- **“Unsupported”, never “false”.** Beliefs are matched to the closest facts (pgvector) and judged supported, contradicted or unsupported. With no matching fact, the result says so.
- **Fixes and translations pass a re-read.** A fix rewrites only its span, never locked phrases, and is shown as safe only if the panel no longer forms the flagged belief, nothing new is unsupported, and most readers still get the intent. Suggested translation wording must pass a re-comparison with the master.
- **Built for a free tier.** At most about 8 generation calls per check (6 for English drafts), rotation across models with cooldowns parsed from 429/503 responses, embedding-model rotation with a word-overlap fallback, and a per-check time budget. When the AI is unavailable, rule findings are still saved and the page says why.
- **The audit log is the source of truth for recall.** Live-page checks and closures are audit entries, so the recall state is derived from the same tamper-evident record reviewers rely on, and closes only for the fact version it was about.
- **Safe fetching.** Live pages are fetched server-side over http(s) only, every redirect re-checked against private, loopback and link-local addresses, with a 12-second timeout and a 2 MB cap; only the matched phrases are kept.
- **One language, one repo.** Everything is TypeScript, so a solo builder can own it end to end.

## Tech, models and services

| Kind | Used |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Database, auth, storage | Supabase (Postgres 15, Auth, Storage, pgvector, row-level security, triggers) |
| AI SDK | Vercel AI SDK v4 (`ai`, `@ai-sdk/google`), zod v3 |
| Models (external service) | Google Gemini: `gemini-3.8-flash`, rotating to `gemini-3.5-flash`, `gemini-flash-latest` and `gemini-3.1-flash-lite`; embeddings `gemini-embedding-001` (768 dims), falling back to `gemini-embedding-2` and `gemini-embedding-2-preview` |
| Libraries | sharp (pixels), diff (word diffs), mammoth (DOCX), unpdf (PDF), lucide-react (icons), clsx |
| Scheduling | Vercel Cron (daily recall sweep and demo reset) |
| Fonts | Newsreader, Inter Tight, JetBrains Mono (Google Fonts via `next/font`) |
| Testing | Vitest (72 unit tests), PGlite migration test, ASCI-Bench CLI, logged end-to-end journeys (see [docs/TESTING.md](docs/TESTING.md)) |
| Data | ASCI Complaint Outcomes (public rulings), see [`data/asci-bench.README.md`](data/asci-bench.README.md) |
| Hosting | Vercel (Mumbai region, next to the database) |

## Run it yourself

You need Node 20+, pnpm 9+, a free Supabase project and (optionally) a free Gemini API key.

```bash
git clone https://github.com/nova-rishabh/readback.git
cd readback
pnpm install
cp .env.example .env.local
```

1. **Supabase.** Create a project, then in **SQL Editor** run, in order, [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_hardening.sql`](supabase/migrations/0002_hardening.sql) and [`0003_round3.sql`](supabase/migrations/0003_round3.sql). Details: [supabase/README.md](supabase/README.md).
2. **Fill in `.env.local`:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, a `DEMO_PASSWORD` (6+ characters) and `GOOGLE_GENERATIVE_AI_API_KEY` (free at https://aistudio.google.com). Without a Gemini key, set `READBACK_MOCK_AI=1`: readers become deterministic stand-ins and every screen says so; rule checks stay real.
3. **Seed and run:**

```bash
pnpm seed      # Velura brand, 4 demo users, 11 drafts with saved checks, facts (+ embeddings), demo store pages
pnpm dev       # http://localhost:3000, then use the "Enter as ..." buttons
pnpm test      # 72 unit tests
pnpm test:db   # applies the migrations to an in-memory Postgres and checks the guards
pnpm bench     # ASCI-Bench: 100 cases x 3 runs (add --ledger for evidence-aware scoring; --limit 20, --mock, --fresh)
```

Optional environment: `GEMINI_MODELS` (comma list for rotation), `READBACK_EMBED_MODELS`, `CRON_SECRET` (protects
`/api/cron/recall`), `DEMO_DAILY_RESET=0` (keep visitors' changes), `NEXT_PUBLIC_SITE_URL` (where seeded posts' live
URLs point). Deploying to Vercel needs only the same variables; `vercel.json` sets the Mumbai region and the daily cron.

## Privacy, security, accessibility and responsible design

- **What leaves the server:** draft text goes to Google Gemini only after the Privacy Gate replaces emails, phone numbers, PAN, Aadhaar, card numbers and embargoed product names with tokens. The image is sent as uploaded: text, faces or logos inside it are **not** masked (redacting images is on the roadmap), and the upload form says so; fact statements sent for embedding pass the same gate. Recall checks fetch only the URL recorded on a post. All of this is disclosed on the landing page and in the app footer.
- **Access control:** row-level security plus triggers that enforce the workflow for anyone calling the database directly (allowed status changes, no self-approval, immutable versions, translation links that cannot be re-pointed, image-only uploads up to 8 MB). Images live in a private bucket behind short-lived signed URLs. The service-role key stays on the server.
- **Prompt-injection hardening:** draft text is fenced in prompts and cannot close its fence; a finding needs a quote from the draft or a confirmed image element, so injected text cannot invent or hide findings on its own.
- **Human control:** Readback never edits content automatically, never publishes, and never blocks a human override. Every finding is labelled `[RULE]` or `[AI]` with the model and the cited clause, fact or WCAG criterion; disputes are recorded with a note; approving with open high-severity findings is recorded as accepted risk.
- **Accessibility:** WCAG 2.2 AA contrast, visible focus, skip link, keyboard-operable menus and tour with focus trap and restore, live regions for streaming results, `lang` attributes on Hindi, Tamil and Marathi text, finding marks that do not rely on colour alone, layouts that work at 375 px.
- **Limits of AI personas:** simulated readers are a model's guess at how people read, not a survey. The panel is a comprehension stress test, kept honest by grounding, multi-reader agreement, a public benchmark and human sign-off.

## Known limitations

- **The shared free Gemini key is slow and limited.** A live check takes one to three minutes; under heavy use the AI stage can save only rule findings (“Partial check”) and the page says why. Adding your own free key from the top bar removes the shared limit. Seeded drafts always show complete results.
- **Demo sign-in is open by design** so judges need no account; production would use invited users. Shared demo data is reset daily.
- **ASCI-Bench reads only claim text,** not the ad's visuals or voice-over, and its cases were picked by reading rather than at random; see the results page for the full method and intervals.
- **Live-page checks read server-rendered text.** Pages that need JavaScript or block automated visitors (some marketplaces) are reported as “could not confirm” rather than closed.
- **Drafts are text plus one image.** Video and multi-image carousels are not supported.
- **Single brand** in the demo workspace (Velura).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Next: real sign-in with invited users and multiple brands; carousel and video
frames; reviewer assignment and SLAs; Slack and email alerts for recalls and expiries; marketplace listing connectors
(Amazon, Nykaa) instead of page fetching; more Indic readers (Bengali, Telugu, Kannada); a larger, randomly sampled
ASCI-Bench with human double-labelling.

## Disclosures

- **Boilerplate:** the first commit is the unmodified `create-next-app` template (Next.js 15, TypeScript, Tailwind). It was entirely replaced in later commits.
- **AI assistance (Rule 7):** product architecture, the dual-engine design, the database schema, RLS and triggers, rule algorithms and testing were designed and integrated by Rishabh Kataria. Claude Code (Anthropic) was used as an AI pair-programming and research assistant during the official build windows, including generating code, collecting the ASCI-Bench cases and extracting the evidence ledger from the public rulings, under his direction and review.
- **External services:** Google Gemini API (generation and embeddings), Supabase, Vercel.
- **Data:** ASCI rulings are public records from ascionline.in, cited per record. “Velura” and all demo people and products are fictional.

## Team

Team Nova: **Rishabh Kataria** (solo). Product, research, AI engine, full-stack app, rule engine, benchmark, testing and documentation (100%).
