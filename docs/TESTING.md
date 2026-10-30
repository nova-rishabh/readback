# Testing Readback

How Readback was tested for Round 3, what the tests found, and what was fixed as a result. Four layers:

1. **Unit tests** (Vitest): the deterministic core, run on every change.
2. **Database migration test** (PGlite): the schema, its guards and that every migration can be re-run.
3. **ASCI-Bench**: the AI engine against 100 real regulator rulings, repeated three times.
4. **End-to-end journeys**: every main journey driven in a browser, including bad input, empty states, reloads,
   repeated actions, quota exhaustion and phone width.

## 1. Unit tests: 73 tests in 10 files

`pnpm test`

| File | Tests | Covers |
|---|---|---|
| `src/lib/rules/__tests__/rules.test.ts` | 16 | Aho-Corasick term matching, banned and preferred terms, disclaimers and their triggers, embargo leaks, WCAG contrast ratios, ΔE2000 palette distance, alt-text checks |
| `src/lib/privacy/__tests__/gate.test.ts` | 7 | Masking of emails, Indian phone numbers, PAN, Aadhaar (spaced and unspaced), Luhn-valid cards, embargoed names, and round-trip unmasking |
| `src/lib/ai/__tests__/grounding.test.ts` | 7 | Locating a reader's quote in the draft (case, punctuation, small edits), offsets, thresholds, **Hindi and Tamil quotes keeping their vowel signs** |
| `src/lib/ai/__tests__/group.test.ts` | 7 | Cosine clustering, distinct-reader counting, the 2-of-6 rule, ambiguous splits, **grouping anchored on the same quote and category**, **one embedding per anchored group** |
| `src/lib/ai/__tests__/drift.test.ts` | 6 | Labelling translated beliefs (added, stronger, weaker, dropped, same); turning drift into findings located in the translation, cited to G-13, with suggested wording; no rewrite when the quote cannot be found |
| `src/lib/recall/__tests__/live.test.ts` | 6 | HTML to visible text, which wording to look for, fuzzy matching on the live page, refusing private and loopback addresses, **never treating a sign-in wall as proof a claim is gone** |
| `src/lib/ai/__tests__/pipeline.test.ts` | 4 | The full check pipeline end to end in mock mode: events in order, findings, summary, locked phrases untouched |
| `src/lib/bench/__tests__/metrics.test.ts` | 3 | Majority verdict across runs, Wilson intervals, recall, false alarms, precision, stability, per-ground breakdown |
| `src/lib/ai/__tests__/provider.test.ts` | 2 | Parsing per-minute and per-day retry hints (“retry in 22h12m17.9s”); ranking facts by shared words when embeddings run out |
| `src/lib/ai/__tests__/tone.test.ts` | 2 | Tone findings cite the brand's voice clause and mark the call to action; no finding when most readers find the tone on-brand |

Type checking (`tsc --noEmit`), ESLint and a production build (`next build`) also run before every deploy.

## 2. Database migrations: `pnpm test:db`

[`scripts/check-migrations.mjs`](../scripts/check-migrations.mjs) applies `0001`, `0002` and `0003` (and `0003` a second
time) to an in-memory Postgres (PGlite, with pgvector) with stand-ins for Supabase's `auth` and `storage` schemas, then
checks the Round 3 guards:

| Check | Result |
|---|---|
| All migrations apply; 0003 applies twice (safe to re-run) | Pass |
| A Tamil translation of an English master is accepted | Pass |
| A translation of a translation is rejected | Rejected: “The master is itself a translation…” |
| A master from another brand is rejected | Rejected: “The master must be a submission of the same brand” |
| An unknown language is rejected | Rejected by `submissions_lang_check` |
| A signed-in user cannot re-point a translation to another master | Rejected: “A translation cannot be re-linked…” |
| Demo store pages update and touch `updated_at` | Pass |

## 3. ASCI-Bench

`pnpm bench` (and `pnpm bench --ledger`). Method, results and every case are on the in-app page **/app/bench**; the
numbers and their intervals are summarised in the [README](../README.md#asci-bench-round-3-results).

What the benchmark found and what changed because of it:

| Run | Finding | Change |
|---|---|---|
| v3.0, 29 cases × 3 runs | Only **52%** of cases got the same verdict on all three runs. Readers phrase one claim many ways (“kills 99% of germs”, “eliminates nearly all microbes”) and embedding similarity split them, so a group sometimes reached 2 of 6 readers and sometimes did not. | Beliefs of the same category anchored on the **same quoted words** now group together, and the reader panel runs at temperature 0. The 8 most unstable cases were re-run: all 8 gave the same verdict on every run. |
| v3.1, 36 cases × 3 runs | **100%** run-to-run stability (36/36) on the fixed engine; the run stopped when the free tier's **1,000 embedding requests per model per day** ran out (the API counts every text, about 17 per run). | Beliefs anchored on the same words are embedded **once per group**, about 3 to 4 times fewer requests. The benchmark uses only the two newer embedding models so it can never use up the live app's quota, and it refuses any run that fell back to word-overlap grouping. |
| v3.2, 100 cases × 3 runs, with and without evidence | Final results: see the README and /app/bench. | |

All runs are kept in `data/` so the history can be checked.

## 4. End-to-end journeys (browser, 29 October 2026)

Driven in a real browser against a local build with the production database, then spot-checked on the deployed app.

| # | Journey | Steps | Result |
|---|---|---|---|
| 1 | Creator submits and checks a draft | Enter as creator → New draft → Fill in the demo draft → Save and run check | Pass. Rule findings in under 20 s; six readers reported; findings saved as they arrived. |
| 2 | Same check when Gemini is at its limit | Re-run the check while the benchmark held the per-minute quota | Pass. Rule findings saved; clear message (“Gemini free-tier limit reached… run the AI check again in 15s”); nothing hung. |
| 3 | Same check when every embedding model is out of quota | Re-run with all three embedding models exhausted and only one generation model left | **Failed first** (raw quota error ended the AI stage). Fixed (see bugs 6 and 7); re-test passed in 61 s with 3 AI findings and a visible “Grouped by word overlap” note. |
| 4 | Reviewer approves and publishes | Enter as reviewer → #142 → Approve v1 (5 open high-severity findings shown as accepted risk) → Record published URL | Pass. `ftp://…` rejected with “Enter the full link… https://”; a valid link moves the post to Published. |
| 5 | Workflow buttons follow the rules | Reviewer on a draft that was never sent for review; reviewer on their own draft | **Failed first** (Approve was offered and then rejected by the server). Fixed: Approve appears only on drafts in review and never on your own. |
| 6 | Translation linked to its master | #145 → Add a translation | Pass. Without migration 0003 the page explains what is missing and offers Compare translations instead of failing. Pipeline verified directly with live Gemini on the Hindi sample: पक्का flagged as a strengthened claim, located in the Hindi, cited to G-13; a suggested rewrite that still dropped “71%” was correctly rejected by the re-comparison gate. |
| 7 | Live recall on a live page | Owner → Recall queue → #139 → Check live page now | Pass. Fetched the deployed demo store page and found “#1 rated Vitamin C serum on Nykaa”: “Claim still live”. Against an undeployed URL: “Page unreachable”, recorded, no false closure. |
| 8 | Live recall on a walled site | Record an Instagram URL on #142, edit fact F-05 as owner | **Risk found**: a login wall would have looked like “claim removed” and closed the recall. Fixed: walled sites and login or bot-check pages report “Could not confirm”. Re-test: the fact edit queued #142, re-checked it in the background, and reported “Could not confirm”. |
| 9 | Manual close | Owner → Close as fixed on #138 with a note | Pass. Moves to Closed recalls with the note; audit entry `recall_closed`. Empty note blocked. |
| 10 | Demo reset | Owner → Brand Space → Reset demo drafts | **Failed first**: the reset re-set demo passwords and signed everyone out. Fixed: an in-app reset leaves accounts alone. Re-test: reset done, still signed in; a second reset within two minutes is refused with a message. |
| 11 | Bad links | `/app/s/not-a-real-id`, `/app/new?master=garbage` | **Failed first** (“could not read from the database”). Fixed: shown as not found. |
| 12 | Draft import | DOCX with text and an image, a fake PDF, an `.exe` | Pass. DOCX text and its first image extracted; “That file is not a valid PDF”; “Upload a PDF, DOCX or TXT file”. |
| 13 | Same action twice | Double-click Run check; Check live page twice within 30 s; reset twice | Pass. Second check refused while one runs; second live check refused for 30 s; second reset refused for two minutes. |
| 14 | Refresh mid-check | Reload the review screen while readers are reading | Pass. The check keeps running on the server (after()) and saves; the page shows saved findings on return. |
| 15 | Empty states | Recall queue with nothing open; benchmark with no results file; translations list with none | Pass. Each explains what will appear and how to get there. |
| 16 | Phone width (375 px) | Landing, inbox, new draft, compare, Brand Space, insights, audit, recall, benchmark, demo store | Pass after one fix: the recall table scrolled sideways; it is now stacked cards on phones. No page scrolls horizontally. |

## Bugs found by Round 3 testing, all fixed

1. Reviewers were offered **Approve** on drafts not sent for review (and on their own drafts); the server then refused.
2. Mistyped links showed a **database error** instead of “not found”.
3. Belief grouping split paraphrases, making verdicts **unstable across runs** (52% stability).
4. The grounding tokenizer dropped **Indic vowel signs**, cutting Hindi, Tamil and Marathi spans short.
5. A **login wall** could have auto-closed a recall as “claim removed”.
6. A used-up embedding quota **ended the AI stage** of a check.
7. Embeddings running out **partway through** a check (after the first call succeeded) also ended it; and with every model cooling down the code threw `undefined`.
8. Saving a fact while embeddings were out of quota **erased its stored vector**, silently dropping it from fact matching, after a 3× retry delay.
9. The in-app demo reset **signed everyone out**.
10. A Round 2 regex contained literal backspace characters, so **tone findings never cited the brand's voice clause**.

## Independent judge-style review (29 October)

A separate AI agent was given only the live link, the repository and the Round 3 rubric, and asked to test Readback as
a judge (prompt in the hackk folder). It scored 77/100 and raised these points, all addressed the same day:

| Finding | Fix |
|---|---|
| A custom draft (“Cures acne overnight…”) completed without flagging the medical claim when the AI ran in fallback mode | Medical and disease claims (cure, treat, heal, prevent + acne, eczema, hair fall, infections…) are now a **rule**, caught by code on every draft and cited to the “not a medicine” fact. |
| A translation that dropped the disclaimer showed it in the comparison but did not raise a finding | A dropped qualifier or disclaimer is now a G-13 finding (“Qualifier dropped”); the comparison prompt lists disclaimers explicitly. |
| Image privacy was described more strongly than implemented | Disclosure, README and the upload field now say plainly that images are sent as uploaded and are not masked. |
| Partial-check messages blamed the per-minute limit when the daily limit was the cause | The real reason is stored with the check and shown (“daily limit”, “overloaded”, “per-minute limit, retry in N s”). |
| A reviewer could approve after a partial check without acknowledging the unassessed AI risks | Approval then requires a checkbox, and the audit note records “Approved without a complete AI check”. |
| Tours interrupted; navigation crowded | Only the inbox tour starts by itself; nav labels shortened. |

## Second independent review (30 October)

Run against commit 2d9b346 with prompt v2 (25 steps, fresh clone, live product). Score 82/100; all three improvements
judged delivered. Defects it reported, and what changed:

| Finding | Fix |
|---|---|
| A reviewer's “request changes” note was in the audit log but not shown on the author's draft | The latest decision note is shown as a banner on the draft, and history lines include notes. |
| A reader's doubt (“no clinical evidence is given”) became a high-severity “contradicted” finding on a harmless sentence | Readers are told to report only what the post claims or implies, never their own doubts; the fact judge marks a criticism as not-a-claim so it is not raised. |
| A rejected double-click looked like a failed check and blanked the reader panel | A duplicate request now keeps the saved results and shows “A check is already running…”, then refreshes. |
| “100% guaranteed” → fix produced “100% designed to support” | Banned-term fixes take a preceding intensifier (100%, totally, absolutely…) with the term. |
| Partial-check approval was enforced only in the browser | The server refuses to approve a version whose AI check did not finish without the explicit acknowledgment. |
| Image text-box errors were silently treated as “no text” | The check records that contrast was not assessed and the draft says so. |
| Expiry day counts differed by one between screens; footer named one model | Dates are counted in India time everywhere; the footer names the rotation and says images are sent unmasked. |
| IPv6 link-local coverage incomplete in the live-page guard | fe80::/10 fully covered. |

Not changed, and stated as limits: the benchmark's false-alarm rate (roadmap item 1), a curated rather than random
sample without human double-labelling, no separate tone finding when only one reader calls a call to action pushy.

## How to reproduce

```bash
pnpm test        # unit tests
pnpm test:db     # migrations in PGlite
pnpm build       # type check, lint, production build
pnpm bench --limit 20 --mock   # benchmark pipeline without API calls
```
