# asci-bench.json

100 real ASCI Consumer Complaints Council (CCC) rulings, for benchmarking Readback's pre-publication claim checker.

## Source

All 100 records come from ASCI's own public Complaint Outcomes database (https://www.ascionline.in/complaint-outcomes/). Each `source_url` is the ruling's detail page (`complaint-outcomes-details?case_id=...`).

How the data was read: the Complaint Outcomes page loads its list through the site's own JSON endpoint (`/wp-json/complaint-outcome/v1/filter-data` and `/show-more`), which I paged through for the Upheld and Not Upheld decision filters. Each response carries the full ruling text (the quoted claim, the advertiser's response, the CCC's reasoning). I also opened the HTML detail pages for the first case (via WebFetch) and spot-checked two more (Yardley, Lifebuoy); both matched the dataset. I did not open all 100 detail pages individually.

Not used: news coverage and the older monthly CCC press-release PDFs. The official database had full rulings with exact claim wording, which made them unnecessary. No record is sourced from a news article.

## How cases were picked

1. Paged about 1,200 Upheld and about 860 Not Upheld rulings (the Not Upheld pool is 1,300+ in total; I fetched only the newest ~900 rows, with duplicates).
2. Keyword-filtered to consumer categories: skincare and personal care, food and beverage, health and wellness, and D2C electronics and appliances.
3. Kept only rulings that quote a specific ad claim and whose outcome is unambiguous. Rulings with split outcomes (some claims upheld, others not) were excluded, including cases where the database label disagreed with the ruling text (for example Himalaya Neem Face Wash and Kerastase, whose rulings contradict their listing label; Bosch and Schwarzkopf, partly upheld).
4. Spread across advertisers and claim types. I picked by reading, not at random, so this is a curated sample and not a statistical sample of ASCI's output.

## Counts

| | skincare | food | health | electronics | other | total |
|---|---|---|---|---|---|---|
| upheld | 20 | 16 | 21 | 8 | 1 | 66 |
| not_upheld | 14 | 8 | 7 | 5 | 0 | 34 |
| total | 34 | 24 | 28 | 13 | 1 | 100 |

Outcome split: 66% upheld, 34% not upheld. Medium: 68 digital, 20 TV, 7 print, 5 other/unspecified. Rulings span 2022 to 2026, with most (86) from 2025-2026.

## Field notes

- `claim_text`: taken from the ruling's description of the ad, as quoted there. It is the claim wording the council examined, not the full ad copy. Where a ruling lists several claims, they are joined. A few records carry a short parenthetical from the ruling (for example, that a before/after visual accompanied the claim).
- `outcome`: `not_upheld` means the CCC found the (quoted) claims not in contravention of the ASCI Code.
- `grounds` is an approximate label. For `upheld` it reflects the language the council used (for example "not substantiated", "misleading by exaggeration"), assigned by keyword rules on the ruling text and not hand-reviewed per record. For `not_upheld` it records the type of challenge examined and rejected, so `unsubstantiated` there means the claim was challenged on substantiation and the council accepted the evidence. `literally_false` is never used because no ruling in the sample is framed that way. `other` is used where the main finding was something else (for example celebrity due diligence).
- `date` is the CCC meeting month where the ruling cites one (for example "2608-CCC" means 2026-08), else the month in the case ID. ASCI's list page shows 22 Oct 2026 as the publication date for many recent rulings, so it is not used. Treat the date as approximate to the month.
- `medium` was read from the ruling's first line ("The Instagram advertisement...", "The TV advertisement..."). Product-pack claims and rulings that do not name a channel are `other`.
- `ruling_summary` is my own paraphrase of the council's reasoning.

## Known limitations

- Not Upheld rulings are a minority of what ASCI publishes, and I could only include 34. The sample is also biased: most Not Upheld cases are large brands (HUL, Nestle, Nivea, Dabur and similar) that supplied clinical or lab evidence. Readback cannot see that evidence, so Not Upheld cases test whether a checker avoids over-flagging claims, not whether it can reproduce the ruling.
- Most Upheld rulings are suo motu (ASCI's own monitoring), often against small D2C brands that did not respond. In those cases "unsubstantiated" mainly means no evidence was submitted. This overstates how often a claim is false and understates how often it is only unproven.
- Many Upheld rulings turn on missing evidence the checker cannot know (clinical studies, sales data). A pre-publication tool can flag a claim type as high-risk but cannot know whether the advertiser holds substantiation.
- The full ad copy (and visuals, which the council often relied on) is not available; only claim text as quoted by ASCI.
- The skew to 2025-2026 reflects the database's ordering, not any change in ASCI's practice. The sample has few 2022-2024 cases.
- Electronics and appliances are the thinnest category (13). The `other` category has 1 record (a vehicle battery).
- Some rulings were reviewed or re-examined; the outcome recorded is the one in the database at the time of retrieval (October 2026).
- Several Hindi claims are quoted in Devanagari as in the ruling.
