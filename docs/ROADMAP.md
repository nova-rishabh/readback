# Readback roadmap

Where Readback stands after Round 3, and what comes next. Each item says what it changes for the people who use it.

## Where it stands (October 2026)

- One workspace (Velura, fictional) with four roles, a full pre-publication check (rules plus a six-reader panel),
  the review workflow, a tamper-evident audit log, translations checked against their English master, and live
  fact recall with a daily sweep.
- ASCI-Bench measures the engine against 100 real regulator rulings.
- Runs on free tiers end to end: Gemini, Supabase, Vercel.

## Next 3 months: make it usable by a real brand team

| Item | What it changes | Notes |
|---|---|---|
| Real sign-in, invites and multiple brands | An agency can serve several brands; a brand can invite its own reviewers. | Supabase Auth invites; brand switcher; RLS already scopes everything by brand. |
| Reviewer assignment and SLAs | Drafts stop waiting in a shared inbox; overdue reviews are visible. | Assignee column, due dates, an overdue filter. |
| Slack and email alerts | Recall, expiry and “changes requested” reach people where they work. | The daily sweep already records alerts in the audit log; add delivery. |
| Marketplace connectors | Amazon and Nykaa listings are checked through their seller APIs instead of page fetches that marketplaces block. | Replaces “could not confirm” for those pages. |
| Carousels and video frames | Instagram carousels and short videos get the same contrast, palette and reader checks. | Sample frames with ffmpeg; one reader call over several images. |
| Paid model option | Checks in 20 to 40 seconds instead of one to three minutes. | The provider already rotates models; add a paid key per workspace. |

## 3 to 6 months: deepen the checks

| Item | What it changes |
|---|---|
| More Indic readers (Bengali, Telugu, Kannada, Gujarati) | Regional campaigns are checked by a native reader of that language, as Tamil and Marathi are now. |
| Claim-to-evidence workflow | When a finding is “unsupported”, the creator can attach evidence; the owner approves it into the Fact Ledger in one step. |
| Guideline coverage report | Shows which clauses never fire and which are disputed most, so the brand can rewrite unclear rules. Builds on Insights. |
| Brand-specific fine-tuned judge | Fewer false alarms on claims the brand has substantiated, measured on ASCI-Bench with evidence. |
| Versioned guidelines | Approvals record which guideline version applied, as they already record fact versions. |

## 6 to 12 months: evidence and scale

| Item | What it changes |
|---|---|
| ASCI-Bench v2 | A randomly sampled set of several hundred rulings, double-labelled by people, with the ad creative where ASCI publishes it; published as an open benchmark. |
| Real-reader calibration | Short surveys with real consumers on a sample of drafts, to measure how well the simulated panel predicts what people actually believe. |
| CMS and design-tool plugins | Check copy where it is written (WordPress, Shopify, Figma, Canva) before it ever reaches the inbox. |
| Self-hosted and on-premise model mode | Brands with strict data rules run the panel on their own model (for example through Ollama or a private endpoint); the Privacy Gate stays in front of every call. |
| Compliance export | A signed report per campaign (findings, decisions, fact versions, hash chain) for legal and regulator queries. |

## Known limits we are designing around

- Simulated readers are a model's guess at how people read. Grounding, multi-reader agreement, the benchmark and human
  sign-off keep them honest, and real-reader calibration is on the plan.
- The free Gemini tier limits speed and daily volume; the engine degrades in steps (model rotation, embedding fallback,
  rule findings only) rather than failing, and a visitor can bring their own key.
- Live-page checks read server-rendered text; pages that need JavaScript are reported as “could not confirm”.
