// The Velura demo workspace: brand rules, facts, users and the seeded drafts, and the routine that writes them.
// Used by `pnpm seed` (scripts/seed.ts) and by the owner's "Reset demo drafts" action and the daily scheduler.
// Idempotent: re-running upserts by email / code / number and resets the seeded drafts (#137-#147) to their
// starting state; drafts people created themselves are left alone, and the insert-only audit log keeps its history.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BeliefCategory, CheckSummary, DriftRow, Finding, FindingCategory, PaletteColor, Role, Severity, Span, Verdict, ReaderResult,
} from "../types";
import { embedText, toVectorLiteral } from "../db/embed";
import { DEMO_PAGES } from "../recall/demo-pages";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// published demo posts point at the app's own demo storefront, so Live Fact Recall has real pages to fetch
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://readback-virid.vercel.app").replace(/\/$/, "");
let admin: SupabaseClient;
let PASSWORD = "";
let log: (line: string) => void = () => undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 864e5;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const dateFromNow = (d: number) => daysFromNow(d).slice(0, 10);

// ------------------------------------------------------------------ users

const USERS: { key: Role; email: string; name: string; org: string }[] = [
  { key: "owner", email: "owner@velura.demo", name: "Priya Owner", org: "Velura" },
  { key: "creator", email: "creator@velura.demo", name: "Arjun Creator", org: "Velura" },
  { key: "reviewer", email: "reviewer@velura.demo", name: "Meera Legal", org: "Velura" },
  { key: "agency", email: "agency@bloomagency.demo", name: "Bloom Agency", org: "Bloom Agency" },
];

async function ensureUsers(brandId: string, refresh: boolean): Promise<Record<Role, { id: string; name: string }>> {
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }
  const out = {} as Record<Role, { id: string; name: string }>;
  for (const u of USERS) {
    let id = existing.get(u.email);
    if (id) {
      // a password update signs the user out everywhere, so an in-app reset leaves existing accounts as they are
      if (refresh) {
        const { error } = await admin.auth.admin.updateUserById(id, { password: PASSWORD, email_confirm: true, user_metadata: { name: u.name } });
        if (error) throw new Error(`updateUser ${u.email}: ${error.message}`);
      }
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { name: u.name },
      });
      if (error || !data.user) throw new Error(`createUser ${u.email}: ${error?.message}`);
      id = data.user.id;
    }
    must(await admin.from("profiles").upsert({ id, name: u.name, role: u.key, org: u.org, brand_id: brandId }), `profile ${u.email}`);
    out[u.key] = { id, name: u.name };
    log(`  user ${u.email} (${u.key})`);
  }
  return out;
}

// ------------------------------------------------------------------ brand content

const PALETTE: PaletteColor[] = [
  { name: "Leaf Green", hex: "#3F7D4E" },
  { name: "Lab White", hex: "#F4F7F2" },
  { name: "Serum Amber", hex: "#E8A33D" },
  { name: "Deep Forest", hex: "#1F3B2C" },
  { name: "Petal Blush", hex: "#F1C9C0" },
];
const VOICE = ["warm", "evidence-led", "never pushy", "plainspoken"];

const CLAUSES: { code: string; title: string; body: string; kind: "rule" | "ai" }[] = [
  { code: "G-01", kind: "rule", title: "No absolute chemical-free language", body: "Never describe Velura products as chemical-free, zero chemicals or free of chemicals. Everything, including water, is a chemical. Quote the ISO 16128 naturally-derived percentage instead." },
  { code: "G-02", kind: "rule", title: "No miracle or exaggerated efficacy language", body: "Avoid words such as miracle, magic, instant or overnight transformation. Describe what the product is designed to do and what testing showed." },
  { code: "G-03", kind: "rule", title: "Results claims carry the disclaimer", body: "Any copy that mentions results, visible improvement or a percentage of users must include '*Results may vary' in the same piece." },
  { code: "G-04", kind: "ai", title: "Clinical and dermatologist claims need cited evidence", body: "Do not say clinically proven, dermatologist-recommended or dermatologist-loved. Dermatologist-tested is allowed (F-03). Any clinical claim must cite a ledger fact." },
  { code: "G-05", kind: "ai", title: "Natural claims quote the ISO 16128 figure", body: "Say '92% naturally derived ingredients (ISO 16128)'. Do not imply the formula is 100% natural, organic or free of synthetic ingredients." },
  { code: "G-06", kind: "rule", title: "No guarantees", body: "Never guarantee a result, timeframe or outcome. Skin responds differently; use 'designed to' or 'may'." },
  { code: "G-07", kind: "rule", title: "Unreleased products stay embargoed", body: "Embargoed product names must not appear in any external copy before the approved launch date." },
  { code: "G-08", kind: "rule", title: "Text on images meets WCAG 1.4.3 contrast", body: "Text overlaid on images needs a contrast ratio of at least 4.5:1 (3:1 for large text)." },
  { code: "G-09", kind: "rule", title: "Every image has meaningful alt text", body: "Describe what the image shows in a sentence. File names and empty alt text are not acceptable." },
  { code: "G-10", kind: "rule", title: "Stay inside the brand palette", body: "Dominant colours in campaign imagery should sit close to the five palette colours. Off-palette greens and blues dilute the brand." },
  { code: "G-11", kind: "ai", title: "Voice: warm, evidence-led, never pushy", body: "Write like a knowledgeable friend. No hard-sell imperatives ('Shop now!', 'Hurry'), no fear or shame." },
  { code: "G-12", kind: "ai", title: "Time-bound results match tested timeframes", body: "Only state a timeframe that a ledger fact supports. The clinical study measured visible radiance from week 4 (F-05, F-07). Do not claim results in days." },
  { code: "G-13", kind: "ai", title: "Translations keep the claim's strength", body: "Hindi and Hinglish copy must not strengthen a claim (for example glow read as fairer skin). Have a native reviewer check borderline words." },
  { code: "G-14", kind: "ai", title: "Offers and urgency must be real and dated", body: "Discounts and deadlines must have an end date recorded in the ledger. No fake scarcity." },
  { code: "G-15", kind: "ai", title: "Rankings and comparisons need a current source", body: "'#1', 'best-selling' and comparative claims must cite a ledger fact that is still in date." },
];

const FACTS: { code: string; statement: string; source: string; owner: string; expires: number | null; version: number; status?: "expired" }[] = [
  { code: "F-01", statement: "Velura Vitamin C Serum contains 15% L-ascorbic acid, stabilised with ferulic acid and vitamin E.", source: "Formulation sheet VEL-FS-014", owner: "R&D, Dr. Kavya Iyer", expires: null, version: 1 },
  { code: "F-02", statement: "Fragrance-free; made without parabens and sulphates.", source: "INCI list and supplier declarations, Q1 2026", owner: "R&D, Dr. Kavya Iyer", expires: null, version: 1 },
  { code: "F-03", statement: "Dermatologist-tested on 112 volunteers with no irritation reported (dermatological safety test).", source: "Safety test VEL-DS-2025-02", owner: "Regulatory, Nandini Rao", expires: 210, version: 2 },
  { code: "F-04", statement: "Passed a human repeat insult patch test (HRIPT, n=50) with no reactions recorded.", source: "HRIPT report VEL-HR-2025-01", owner: "Regulatory, Nandini Rao", expires: 320, version: 1 },
  { code: "F-05", statement: "Visible brightness improvement was measured from week 4 of daily use, not earlier (colorimeter, n=112).", source: "Clinical study VEL-CS-2025-03", owner: "Clinical, Dr. Arvind Shah", expires: 400, version: 1 },
  { code: "F-06", statement: "Skin hydration increased by 24% after 2 weeks of daily use (corneometer, n=112).", source: "Clinical study VEL-CS-2025-03", owner: "Clinical, Dr. Arvind Shah", expires: 400, version: 1 },
  { code: "F-07", statement: "71% of users saw more radiant skin at week 4 (n=112, in-vivo, self-assessment).", source: "Clinical study VEL-CS-2025-03", owner: "Clinical, Dr. Arvind Shah", expires: 400, version: 1 },
  { code: "F-08", statement: "Vegan formula with no animal-derived ingredients; not tested on animals.", source: "Cruelty-free declaration VEL-CF-2025", owner: "Regulatory, Nandini Rao", expires: 180, version: 1 },
  { code: "F-09", statement: "Packaged in a recyclable glass bottle with an aluminium pump; the carton is 100% recycled paper.", source: "Packaging spec VEL-PK-007 and supplier certificate", owner: "Operations, Rohan Mehta", expires: 18, version: 1 },
  { code: "F-10", statement: "Ranked #1 Vitamin C serum in Nykaa's Skin Care bestseller list for January to March 2026.", source: "Nykaa seller dashboard export, Q1 2026", owner: "Marketing, Sana Qureshi", expires: -41, version: 1, status: "expired" },
  { code: "F-11", statement: "Average rating 4.6 from 2,310 verified buyers (as of 30 September 2026).", source: "Verified review export, 30 Sep 2026", owner: "Marketing, Sana Qureshi", expires: 60, version: 1 },
  { code: "F-12", statement: "92% of ingredients are naturally derived (ISO 16128).", source: "ISO 16128 calculation sheet VEL-ISO-2026", owner: "R&D, Dr. Kavya Iyer", expires: 330, version: 2 },
  { code: "F-13", statement: "Manufactured in India at a GMP-certified facility in Baddi, Himachal Pradesh.", source: "GMP certificate no. HP/GMP/2025/118", owner: "Operations, Rohan Mehta", expires: 365, version: 1 },
  { code: "F-14", statement: "Free shipping on orders above Rs 499; 7-day returns on unopened products.", source: "Store policy v3", owner: "Operations, Rohan Mehta", expires: null, version: 1 },
  { code: "F-15", statement: "MRP is Rs 899 for 30 ml.", source: "Price list, October 2026", owner: "Finance, Isha Kapoor", expires: 150, version: 1 },
  { code: "F-16", statement: "Velura is a cosmetic, not a medicine; it does not treat acne, pigmentation disorders or any skin condition.", source: "Regulatory position paper RP-2025-04", owner: "Regulatory, Nandini Rao", expires: null, version: 1 },
];

const TERMS: { kind: "banned" | "preferred" | "disclaimer" | "embargo"; phrase: string; replacement: string | null; clause_code: string; triggers?: string[] }[] = [
  { kind: "banned", phrase: "zero chemicals", replacement: "92% naturally derived ingredients", clause_code: "G-01" },
  { kind: "banned", phrase: "chemical-free", replacement: "92% naturally derived ingredients", clause_code: "G-01" },
  { kind: "banned", phrase: "guaranteed", replacement: "designed to support", clause_code: "G-06" },
  { kind: "banned", phrase: "clinically proven", replacement: "tested in a clinical study", clause_code: "G-04" },
  { kind: "banned", phrase: "miracle", replacement: "effective", clause_code: "G-02" },
  { kind: "preferred", phrase: "skin-loving", replacement: null, clause_code: "G-11" },
  { kind: "preferred", phrase: "gentle on skin", replacement: null, clause_code: "G-11" },
  { kind: "preferred", phrase: "naturally derived", replacement: null, clause_code: "G-05" },
  { kind: "preferred", phrase: "dermatologist-tested", replacement: null, clause_code: "G-04" },
  { kind: "preferred", phrase: "radiant-looking", replacement: null, clause_code: "G-11" },
  { kind: "disclaimer", phrase: "*Results may vary", replacement: null, clause_code: "G-03", triggers: ["results", "visible", "% saw"] },
  { kind: "embargo", phrase: "Velura Nightshift", replacement: null, clause_code: "G-07" },
];

const PERSONAS = [
  { name: "Urban working woman, 25-34", lang: "en", description: "Works long hours in a metro, shops on Nykaa and Instagram, wants a short routine she can trust. Skims copy quickly and remembers headline numbers." },
  { name: "College student on a budget", lang: "hinglish", description: "Follows skincare creators, compares prices before buying, reads captions in Hinglish and is quick to spot hype or fake discounts." },
  { name: "Skin-concern-focused reader, 35+", lang: "en", description: "Reads ingredient lists and claims carefully, has tried several actives, wants realistic timelines and evidence before spending." },
];

// ------------------------------------------------------------------ finding builders

const READERS = [
  "Urban working woman, 25-34", "College student on a budget", "Skin-concern-focused reader, 35+",
  "Literal first-time buyer", "Hindi/Hinglish reader", "ASCI code sceptic",
];
const clauseTitle = (code: string) => CLAUSES.find((c) => c.code === code)!.title;
const cl = (code: string) => ({ kind: "clause" as const, code, text: clauseTitle(code) });
const fa = (code: string) => ({ kind: "fact" as const, code, text: FACTS.find((f) => f.code === code)!.statement });
const wcag = (code: string, text: string) => ({ kind: "wcag" as const, code, text });

function sp(body: string, phrase: string): Span {
  const i = body.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) throw new Error(`span "${phrase}" not in body`);
  return { start: i, end: i + phrase.length, text: body.slice(i, i + phrase.length) };
}

interface FOpts {
  id: string; engine: "rule" | "ai"; category: FindingCategory; severity: Severity; title: string; explanation: string;
  citation?: Finding["citation"]; span?: Span | null; measured?: Finding["measured"]; suggestion?: Finding["suggestion"];
  status?: Finding["status"]; dispute_note?: string;
  belief?: { statement: string; category: BeliefCategory; k: number; verdict: Verdict; fact_code?: string; visual?: string };
}
function F(o: FOpts): Finding {
  return {
    id: o.id, engine: o.engine, category: o.category, severity: o.severity, title: o.title, explanation: o.explanation,
    citation: o.citation ?? null, span: o.span ?? null, model: o.engine === "ai" ? MODEL : null,
    belief: o.belief ? {
      statement: o.belief.statement, category: o.belief.category, readers: o.belief.k, of: 6,
      reader_names: READERS.slice(0, o.belief.k), verdict: o.belief.verdict,
      fact_code: o.belief.fact_code ?? null, visual_element: o.belief.visual ?? null,
    } : undefined,
    measured: o.measured, suggestion: o.suggestion ?? null, status: o.status ?? "open",
    ...(o.dispute_note ? { dispute_note: o.dispute_note } : {}),
  };
}
const fix = (replacement: string, rationale: string, ub: number, ua: number, intent: number, passed = true) => ({
  replacement, rationale,
  reread: { passed, unsupported_before: ub, unsupported_after: ua, new_unsupported: 0, intent_kept: intent, of: 6 },
});
const ruleFix = (replacement: string, rationale: string) => ({ replacement, rationale, reread: null });

type SeedReader = [name: string, intent: boolean, takeaway: string, tone: string[], beliefs: [string, string, BeliefCategory][]];
const reader = ([name, intent_match, takeaway, tone, beliefs]: SeedReader): ReaderResult => ({
  persona_id: name.startsWith("builtin-") ? name : `seed:${name}`,
  persona_name: BUILTIN_NAMES[name] ?? name,
  takeaway, tone, intent_match,
  beliefs: beliefs.map(([belief, trigger_quote, category]) => ({ belief, trigger_quote, visual_element: null, category, confidence: 0.8, grounded: true })),
});
const BUILTIN_NAMES: Record<string, string> = {
  "builtin-literal": "Literal first-time buyer", "builtin-hindi": "Hindi/Hinglish reader", "builtin-asci": "ASCI code sceptic",
};

function summary(findings: Finding[], intentKept: number, ms: number, masked = 0, readers?: SeedReader[]): CheckSummary {
  return {
    readers: readers?.map(reader),
    rule_count: findings.filter((f) => f.engine === "rule").length,
    ai_count: findings.filter((f) => f.engine === "ai").length,
    high: findings.filter((f) => f.severity === "high").length,
    intent_kept: intentKept, of: 6, ms_total: ms, model: MODEL, mode: "cloud", masked_tokens: masked,
  };
}

// ------------------------------------------------------------------ submissions

// What the six readers took away from #142, so the reader panel is filled on the seeded demo draft.
const R142: SeedReader[] = [
  ["Urban working woman, 25-34", true, "A Vitamin C serum that dermatologists recommend and that makes skin glow within a week.", ["confident", "pushy"],
    [["Dermatologists recommend this serum", "Dermatologist-loved", "endorsement"], ["Skin will visibly glow within 7 days", "Visible glow in 7 days", "efficacy"]]],
  ["College student on a budget", true, "Doctor-approved serum, fully natural, fast results: sounds worth the money.", ["salesy", "exciting"],
    [["Results are guaranteed in a week", "Visible glow in 7 days", "guarantee"], ["The formula has no chemicals at all", "zero chemicals", "environment"]]],
  ["Skin-concern-focused reader, 35+", true, "A brightening serum, but doctor-loved, 7-day glow and chemical-free are big claims. I'd want proof.", ["exaggerated", "pushy"],
    [["Dermatologists endorse it", "Dermatologist-loved", "endorsement"], ["It is 100% natural", "100% natural", "environment"], ["Visible results in a week", "Visible glow in 7 days", "efficacy"]]],
  ["builtin-literal", true, "A serum doctors love that gives glowing skin in 7 days and has no chemicals.", ["urgent"],
    [["Doctors recommend it", "Dermatologist-loved", "endorsement"], ["Glow is guaranteed in 7 days", "Visible glow in 7 days", "guarantee"], ["Contains zero chemicals", "zero chemicals", "environment"]]],
  ["builtin-hindi", false, "Lagta hai doctor approved hai aur ek hafte mein pakka glow aayega.", ["pushy"],
    [["A glow is certain within a week", "Visible glow in 7 days", "guarantee"], ["Fully natural product", "100% natural", "environment"]]],
  ["builtin-asci", false, "Endorsement implied without evidence; 7-day result and chemical-free claims look unsubstantiated.", ["misleading", "exaggerated"],
    [["Implied dermatologist endorsement", "Dermatologist-loved", "endorsement"], ["Unsubstantiated 7-day efficacy", "Visible glow in 7 days", "efficacy"], ["Absolute natural / chemical-free claim", "zero chemicals", "environment"]]],
];

interface SeedVersion { n: number; body: string; image?: boolean; alt?: string | null; findings: Finding[]; summary: CheckSummary; ageDays: number }
interface SeedSub {
  number: number; title: string; channel: string; lang: string; intent: string; status: string; author: Role;
  locked: string[]; url?: string; versions: SeedVersion[]; cites: { code: string; version: number }[]; ageDays: number;
  master?: number; // translations: the number of the English master
}

export function buildSubmissions(): SeedSub[] {
  const subs: SeedSub[] = [];

  // #137 published, clean
  {
    const body = "Hydra-Dew is here. In a 2-week study, skin hydration rose 24% with daily use (n=112, corneometer). Fragrance-free and made in India. *Results may vary";
    const fs = [
      F({ id: "f137-1", engine: "ai", category: "claim", severity: "low", title: "Belief supported: hydration gain in two weeks", explanation: "5 of 6 readers took away that skin is measurably more hydrated after two weeks. Fact F-06 supports it, including the sample size.", citation: fa("F-06"), span: sp(body, "skin hydration rose 24%"), belief: { statement: "Skin is measurably more hydrated after two weeks of daily use", category: "efficacy", k: 5, verdict: "supported", fact_code: "F-06" } }),
      F({ id: "f137-2", engine: "ai", category: "claim", severity: "low", title: "Belief supported: fragrance-free", explanation: "4 of 6 readers noticed the fragrance-free claim. Fact F-02 supports it.", citation: fa("F-02"), span: sp(body, "Fragrance-free"), belief: { statement: "The product contains no added fragrance", category: "health", k: 4, verdict: "supported", fact_code: "F-02" } }),
    ];
    subs.push({ number: 137, title: "Hydra-Dew launch reel caption", channel: "instagram", lang: "en", intent: "Hydra-Dew measurably hydrates skin in two weeks.", status: "published", author: "creator", locked: ["*Results may vary"], url: `${SITE}/store/velura-hydra-dew-reel`, cites: [{ code: "F-06", version: 1 }, { code: "F-02", version: 1 }], ageDays: 26,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 6, 9100), ageDays: 26 }] });
  }

  // #138 approved, cites F-12 at v1 (fact now v2 -> recall)
  {
    const body = "15% L-ascorbic acid Vitamin C serum with ferulic acid and vitamin E. 92% naturally derived ingredients (ISO 16128). Vegan, fragrance-free, 30 ml glass bottle.";
    const fs = [
      F({ id: "f138-1", engine: "ai", category: "claim", severity: "low", title: "Belief supported: 15% L-ascorbic acid", explanation: "6 of 6 readers read the actives correctly. Fact F-01 matches the formulation sheet.", citation: fa("F-01"), span: sp(body, "15% L-ascorbic acid"), belief: { statement: "The serum contains 15% L-ascorbic acid", category: "efficacy", k: 6, verdict: "supported", fact_code: "F-01" } }),
      F({ id: "f138-2", engine: "ai", category: "claim", severity: "low", title: "Belief supported: 92% naturally derived", explanation: "5 of 6 readers understood this as mostly natural, not fully natural. Fact F-12 supports the ISO 16128 figure.", citation: fa("F-12"), span: sp(body, "92% naturally derived ingredients (ISO 16128)"), belief: { statement: "Most, but not all, ingredients are naturally derived", category: "environment", k: 5, verdict: "supported", fact_code: "F-12" } }),
    ];
    subs.push({ number: 138, title: "Amazon listing bullets: Vitamin C serum", channel: "amazon", lang: "en", intent: "A potent, mostly natural Vitamin C serum.", status: "approved", author: "agency", locked: ["92% naturally derived ingredients (ISO 16128)"], cites: [{ code: "F-01", version: 1 }, { code: "F-12", version: 1 }], ageDays: 18,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 5, 8700), ageDays: 18 }] });
  }

  // #139 published, cites expired F-10
  {
    const body = "India's #1 rated Vitamin C serum on Nykaa. Loved by 2,310 verified buyers (4.6 stars). Shop the bestseller.";
    const fs = [
      F({ id: "f139-1", engine: "ai", category: "claim", severity: "medium", title: "Belief supported at check time: #1 on Nykaa", explanation: "6 of 6 readers believed Velura is the top-ranked Vitamin C serum on Nykaa. Fact F-10 supported this on the day of the check; the ranking covers January to March 2026 only.", citation: fa("F-10"), span: sp(body, "#1 rated Vitamin C serum on Nykaa"), belief: { statement: "Velura is currently the top-ranked Vitamin C serum on Nykaa", category: "comparison", k: 6, verdict: "supported", fact_code: "F-10" } }),
      F({ id: "f139-2", engine: "ai", category: "claim", severity: "low", title: "Belief supported: 4.6 star rating", explanation: "5 of 6 readers noted the rating. Fact F-11 supports both the score and the review count.", citation: fa("F-11"), span: sp(body, "2,310 verified buyers (4.6 stars)"), belief: { statement: "Buyers rate the serum 4.6 out of 5", category: "endorsement", k: 5, verdict: "supported", fact_code: "F-11" } }),
    ];
    subs.push({ number: 139, title: "Nykaa banner: top-rated Vitamin C", channel: "nykaa", lang: "en", intent: "Velura is the top-rated Vitamin C serum on Nykaa.", status: "published", author: "creator", locked: ["2,310 verified buyers"], url: `${SITE}/store/velura-vitamin-c-nykaa`, cites: [{ code: "F-10", version: 1 }, { code: "F-11", version: 1 }], ageDays: 21,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 6, 8300), ageDays: 21 }] });
  }

  // #140 changes_requested, two versions (Hinglish)
  {
    const v1 = "Diwali dhamaka! Velura Vitamin C serum pe flat 30% off, sirf aaj raat tak. Guaranteed glow in 7 din, 100% chemical-free! Abhi order karo.";
    const f1 = [
      F({ id: "f140-1-1", engine: "rule", category: "terminology", severity: "high", title: "Banned term: “Guaranteed”", explanation: "Guarantees are not allowed in Velura copy because results vary from person to person.", citation: cl("G-06"), span: sp(v1, "Guaranteed"), suggestion: ruleFix("designed to support", "Banned-term replacement from the brand's term list.") }),
      F({ id: "f140-1-2", engine: "rule", category: "terminology", severity: "high", title: "Banned term: “chemical-free”", explanation: "Nothing is chemical-free. The ledger supports 92% naturally derived ingredients (F-12).", citation: cl("G-01"), span: sp(v1, "chemical-free"), suggestion: ruleFix("92% naturally derived ingredients", "Banned-term replacement from the brand's term list.") }),
      F({ id: "f140-1-3", engine: "ai", category: "claim", severity: "high", title: "Readers believed a guaranteed glow in a week", explanation: "6 of 6 readers believed results would show within 7 days. The study measured visible brightness from week 4 (F-05).", citation: fa("F-05"), span: sp(v1, "Guaranteed glow in 7 din"), belief: { statement: "A glow is guaranteed within 7 days", category: "guarantee", k: 6, verdict: "contradicted", fact_code: "F-05" }, suggestion: fix("Glow dikh sakta hai 4 hafte ke daily use se", "Moves the timeframe to the tested 4 weeks and drops the guarantee.", 2, 0, 5) }),
      F({ id: "f140-1-4", engine: "ai", category: "claim", severity: "medium", title: "Readers believed the offer ends tonight", explanation: "5 of 6 readers believed the discount expires tonight. No fact in the ledger records the offer or its end date.", citation: cl("G-14"), span: sp(v1, "sirf aaj raat tak"), belief: { statement: "The 30% discount ends tonight", category: "urgency", k: 5, verdict: "unsupported" } }),
      F({ id: "f140-1-5", engine: "ai", category: "tone", severity: "low", title: "Tone reads as pushy", explanation: "4 of 6 readers described the copy as pushy or salesy, against the voice trait “never pushy”.", citation: cl("G-11"), span: sp(v1, "Abhi order karo."), suggestion: fix("Order karne ke liye link dekhein.", "Keeps the call to action but removes the pressure.", 0, 0, 5) }),
    ];
    const v2 = "Diwali offer: Velura Vitamin C serum pe 30% off, 31 Oct tak. 4 hafte ke daily use se glow dikh sakta hai. *Results may vary";
    const f2 = [
      F({ id: "f140-2-1", engine: "ai", category: "claim", severity: "medium", title: "Offer dates are not in the ledger", explanation: "4 of 6 readers believed the offer is 30% off until 31 Oct. No fact records this offer, so it is unsupported rather than false.", citation: cl("G-14"), span: sp(v2, "30% off, 31 Oct tak"), belief: { statement: "The serum is 30% off until 31 October", category: "price", k: 4, verdict: "unsupported" }, status: "disputed", dispute_note: "Offer terms are in the campaign brief, signed off by Marketing on 20 Oct. Please add it to the ledger." }),
      F({ id: "f140-2-2", engine: "ai", category: "language_drift", severity: "medium", title: "“Glow” may be read as fairer skin", explanation: "3 of 6 readers took “glow dikh sakta hai” as skin becoming fairer, 3 of 6 as radiance. This split is ambiguous; the claim in English is radiance only.", citation: cl("G-13"), span: sp(v2, "glow dikh sakta hai"), belief: { statement: "The serum will make skin fairer", category: "efficacy", k: 3, verdict: "ambiguous" }, suggestion: fix("radiance dikh sakti hai", "“Radiance” avoids the fairness reading in Hindi.", 3, 0, 5) }),
      F({ id: "f140-2-3", engine: "ai", category: "claim", severity: "low", title: "Belief supported: results from week 4", explanation: "5 of 6 readers understood results take about four weeks. Fact F-05 supports the timeframe.", citation: fa("F-05"), span: sp(v2, "4 hafte ke daily use"), belief: { statement: "Visible results take about 4 weeks of daily use", category: "efficacy", k: 5, verdict: "supported", fact_code: "F-05" } }),
    ];
    subs.push({ number: 140, title: "Diwali WhatsApp broadcast", channel: "whatsapp", lang: "hinglish", intent: "Velura Vitamin C serum is 30% off this Diwali.", status: "changes_requested", author: "agency", locked: ["30% off"], cites: [{ code: "F-05", version: 1 }], ageDays: 9,
      versions: [
        { n: 1, body: v1, findings: f1, summary: summary(f1, 5, 10400), ageDays: 9 },
        { n: 2, body: v2, findings: f2, summary: summary(f2, 5, 9600), ageDays: 6 },
      ] });
  }

  // #141 in_review: embargo breach
  {
    const body = "Sneak peek: Velura Nightshift, our retinol night cream, lands in January. Join the waitlist for first access.";
    const fs = [
      F({ id: "f141-1", engine: "rule", category: "embargo", severity: "high", title: "Embargoed term: “Velura Nightshift”", explanation: "Velura Nightshift is unreleased and embargoed until the approved launch date.", citation: cl("G-07"), span: sp(body, "Velura Nightshift"), suggestion: ruleFix("our next launch", "Neutral wording that does not name the embargoed product.") }),
      F({ id: "f141-2", engine: "ai", category: "claim", severity: "low", title: "Readers believed a retinol cream launches in January", explanation: "6 of 6 readers believed a retinol night cream arrives in January. No fact in the ledger covers a launch date.", citation: cl("G-14"), span: sp(body, "lands in January"), belief: { statement: "A Velura retinol night cream launches in January", category: "urgency", k: 6, verdict: "unsupported" } }),
    ];
    subs.push({ number: 141, title: "Email: waitlist teaser", channel: "email", lang: "en", intent: "Join the waitlist for Velura's next launch.", status: "in_review", author: "creator", locked: ["Join the waitlist"], cites: [], ageDays: 4,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 6, 7900, 1), ageDays: 4 }] });
  }

  // #142 hero draft with image (in review)
  {
    const body = "Dermatologist-loved Vitamin C serum. Visible glow in 7 days. 100% natural, zero chemicals. Shop now";
    const alt = "Model in a white lab coat holding a Velura serum bottle, surrounded by green leaves";
    const fs = [
      F({ id: "f142-1", engine: "rule", category: "terminology", severity: "high", title: "Banned term: “zero chemicals”", explanation: "Nothing is chemical-free. Use the supported figure instead.", citation: cl("G-01"), span: sp(body, "zero chemicals"), suggestion: ruleFix("92% naturally derived ingredients", "Banned-term replacement from the brand's term list.") }),
      F({ id: "f142-2", engine: "rule", category: "disclaimer", severity: "medium", title: "Missing disclaimer: *Results may vary", explanation: "“Visible” is a results trigger, and the required disclaimer does not appear anywhere in the copy.", citation: cl("G-03"), span: sp(body, "Visible glow in 7 days") }),
      F({ id: "f142-3", engine: "rule", category: "accessibility", severity: "high", title: "Image text fails contrast (1.2:1)", explanation: "The overlay text “Visible glow in 7 days” is pale on a pale panel. It needs at least 3:1 as large text and reads about 1.2:1.", citation: wcag("1.4.3", "Contrast (Minimum)"), measured: { ratio: 1.2, fg: "#D3DFD0", bg: "#E6EDE3", required: 3 } }),
      F({ id: "f142-4", engine: "rule", category: "visual", severity: "low", title: "Off-palette colour: bright green (#5DBB3F)", explanation: "About 14% of the image is a green far from Leaf Green #3F7D4E (ΔE 24).", citation: cl("G-10"), measured: { color: "#5DBB3F", share: 0.14, delta_e: 24, nearest: "Leaf Green" } }),
      F({ id: "f142-5", engine: "ai", category: "claim", severity: "high", title: "Readers believed results show in 7 days", explanation: "5 of 6 readers believed visible results appear within a week. The study measured visible brightness from week 4 (F-05), so this contradicts the ledger.", citation: fa("F-05"), span: sp(body, "Visible glow in 7 days"), belief: { statement: "Skin looks visibly glowing within 7 days", category: "efficacy", k: 5, verdict: "contradicted", fact_code: "F-05" }, suggestion: fix("Visible radiance from week 4", "Replaces the 7-day timeframe with the tested week 4 result.", 3, 0, 5) }),
      F({ id: "f142-6", engine: "ai", category: "claim", severity: "high", title: "Readers believed the formula is fully natural", explanation: "6 of 6 readers believed there are no synthetic ingredients. Fact F-12 supports 92% naturally derived, so “100% natural” is contradicted.", citation: fa("F-12"), span: sp(body, "100% natural"), belief: { statement: "The serum contains only natural ingredients", category: "environment", k: 6, verdict: "contradicted", fact_code: "F-12" }, suggestion: fix("92% naturally derived", "Uses the ISO 16128 figure from the ledger.", 3, 0, 5) }),
      F({ id: "f142-7", engine: "ai", category: "claim", severity: "high", title: "Readers believed dermatologists recommend it", explanation: "4 of 6 readers believed dermatologists recommend or love this serum. Fact F-03 only supports “dermatologist-tested”, so the endorsement is unsupported.", citation: fa("F-03"), span: sp(body, "Dermatologist-loved"), belief: { statement: "Dermatologists recommend this serum", category: "endorsement", k: 4, verdict: "unsupported", fact_code: "F-03" }, suggestion: fix("Dermatologist-tested", "Matches fact F-03 exactly.", 3, 0, 5) }),
      F({ id: "f142-8", engine: "ai", category: "visual", severity: "medium", title: "Lab coat may read as a doctor's endorsement", explanation: "3 of 6 readers saw the white lab coat as a clinician endorsing the product, 3 of 6 as styling. This split is ambiguous.", citation: cl("G-04"), belief: { statement: "A doctor or scientist is endorsing this product", category: "endorsement", k: 3, verdict: "ambiguous", visual: "model in a white lab coat" }, status: "disputed", dispute_note: "The lab coat was in the approved creative brief and the model is not presented as a doctor." }),
      F({ id: "f142-9", engine: "ai", category: "tone", severity: "low", title: "Tone reads as pushy", explanation: "4 of 6 readers called the closing line pushy, against the voice trait “never pushy”.", citation: cl("G-11"), span: sp(body, "Shop now"), suggestion: fix("Explore the serum", "Keeps the call to action without pressure.", 0, 0, 5) }),
    ];
    subs.push({ number: 142, title: "Hero post: Vitamin C serum", channel: "instagram", lang: "en", intent: "Velura's Vitamin C serum gives a visible glow.", status: "in_review", author: "agency", locked: ["Vitamin C serum"], cites: [{ code: "F-05", version: 1 }, { code: "F-12", version: 2 }, { code: "F-03", version: 2 }], ageDays: 2,
      versions: [{ n: 1, body, image: true, alt, findings: fs, summary: summary(fs, 4, 14200, 0, R142), ageDays: 2 }] });
  }

  // #143 draft
  {
    const body = "Winter skincare routine: cleanse, apply two drops of Vitamin C serum in the morning, then moisturiser and sunscreen. A skin-loving routine for dry weather.";
    const fs = [
      F({ id: "f143-1", engine: "ai", category: "claim", severity: "low", title: "Dose of two drops is not in the ledger", explanation: "3 of 6 readers took “two drops” as the recommended dose. No fact records a dosage, so this is unsupported.", citation: cl("G-14"), span: sp(body, "two drops"), belief: { statement: "Two drops is the correct daily amount", category: "efficacy", k: 3, verdict: "unsupported" } }),
    ];
    subs.push({ number: 143, title: "Blog: winter skincare routine", channel: "website", lang: "en", intent: "A simple winter routine that includes Velura Vitamin C serum.", status: "draft", author: "creator", locked: ["skin-loving"], cites: [], ageDays: 1,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 6, 7600), ageDays: 1 }] });
  }

  // #144 recalled
  {
    const body = "Clinically proven results in 14 days. Velura Vitamin C serum, the miracle serum dermatologists recommend. *Results may vary";
    const fs = [
      F({ id: "f144-1", engine: "rule", category: "terminology", severity: "high", title: "Banned term: “Clinically proven”", explanation: "Clinical claims need a cited ledger fact. Velura's study supports specific measured results only.", citation: cl("G-04"), span: sp(body, "Clinically proven"), suggestion: ruleFix("tested in a clinical study", "Banned-term replacement from the brand's term list.") }),
      F({ id: "f144-2", engine: "rule", category: "terminology", severity: "medium", title: "Banned term: “miracle”", explanation: "Miracle language overstates efficacy.", citation: cl("G-02"), span: sp(body, "miracle"), suggestion: ruleFix("effective", "Banned-term replacement from the brand's term list.") }),
      F({ id: "f144-3", engine: "ai", category: "claim", severity: "high", title: "Readers believed results show in 14 days", explanation: "5 of 6 readers believed results arrive within two weeks. The study measured visible brightness from week 4 (F-05).", citation: fa("F-05"), span: sp(body, "results in 14 days"), belief: { statement: "Results are visible in 14 days", category: "efficacy", k: 5, verdict: "contradicted", fact_code: "F-05" }, suggestion: fix("results from week 4", "Moves the timeframe to the tested week 4.", 3, 0, 5) }),
      F({ id: "f144-4", engine: "ai", category: "claim", severity: "high", title: "Readers believed dermatologists recommend it", explanation: "6 of 6 readers believed dermatologists recommend the serum. Fact F-03 only supports “dermatologist-tested”.", citation: fa("F-03"), span: sp(body, "dermatologists recommend"), belief: { statement: "Dermatologists recommend this serum", category: "endorsement", k: 6, verdict: "unsupported", fact_code: "F-03" }, suggestion: fix("dermatologist-tested", "Matches fact F-03 exactly.", 3, 0, 5) }),
    ];
    subs.push({ number: 144, title: "Story: Vitamin C results", channel: "instagram", lang: "en", intent: "Velura's Vitamin C serum works quickly.", status: "recalled", author: "creator", locked: [], url: "https://www.instagram.com/stories/velura/144/", cites: [{ code: "F-05", version: 1 }, { code: "F-03", version: 2 }], ageDays: 30,
      versions: [{ n: 1, body, alt: null, findings: fs, summary: summary(fs, 5, 9900), ageDays: 30 }] });
  }

  // #145-147: an approved English master and two translations linked to it (Round 3: cross-language consistency)
  const MASTER_145 = "Velura Vitamin C serum. 71% saw more radiant skin in 4 weeks.* Gentle enough for daily use.\n*Results may vary.";
  {
    const body = MASTER_145;
    const findings = [
      F({ id: "f145-1", engine: "ai", category: "claim", severity: "low", title: "Belief supported: 71% saw more radiant skin at week 4", explanation: "6 of 6 readers took away that most, not all, users saw more radiant skin after four weeks. Fact F-07 supports it, including the timeframe.", citation: fa("F-07"), span: sp(body, "71% saw more radiant skin in 4 weeks"), belief: { statement: "Most users saw more radiant skin after four weeks", category: "efficacy", k: 6, verdict: "supported", fact_code: "F-07" } }),
    ];
    subs.push({ number: 145, title: "Website banner: Vitamin C results", channel: "website", lang: "en", intent: "Most users see more radiant skin after four weeks of Velura Vitamin C serum.", status: "approved", author: "creator", locked: ["*Results may vary."], cites: [{ code: "F-07", version: 1 }], ageDays: 6,
      versions: [{ n: 1, body, findings, summary: summary(findings, 6, 41_200), ageDays: 6 }] });
  }
  {
    const body = "Velura विटामिन C सीरम। 4 हफ्तों में पक्का निखार।* रोज़ इस्तेमाल के लिए सौम्य।\n*परिणाम अलग हो सकते हैं।";
    const drift = (o: { id: string; kind: "new_belief" | "strengthened"; title: string; explanation: string; span: Span; statement: string; category: BeliefCategory; k: number; fix: string }): Finding => ({
      ...F({ id: o.id, engine: "ai", category: "language_drift", severity: "high", title: o.title, explanation: o.explanation, citation: cl("G-13"), span: o.span, belief: { statement: o.statement, category: o.category, k: o.k, verdict: "unsupported" } }),
      clause_code: "G-13", drift_kind: o.kind,
      suggestion: { replacement: o.fix, rationale: "Keeps the translation at the strength of the English master.", source: "translation", reread: { passed: true, unsupported_before: 2, unsupported_after: 0, new_unsupported: 0, still_held: false, intent_kept: 6, of: 6 } },
    });
    const findings = [
      drift({ id: "drift-1-guarantee", kind: "new_belief", title: "Added in Hindi: The glow is guaranteed", explanation: "6 of 6 readers believe this from the Hindi version. The English master (#145) does not say this at all. पक्का means “certain” or “guaranteed”; the English never promises a result.", span: sp(body, "पक्का निखार"), statement: "The glow is guaranteed", category: "guarantee", k: 6, fix: "निखार दिख सकता है" }),
      drift({ id: "drift-2-efficacy", kind: "strengthened", title: "Made stronger in Hindi: Everyone gets glowing skin in 4 weeks", explanation: "5 of 6 readers believe this from the Hindi version. The English master only says “71% of users saw more radiant skin after 4 weeks”. The Hindi drops “71% saw”, so the result reads as certain for everyone.", span: sp(body, "4 हफ्तों में"), statement: "Everyone gets glowing skin within 4 weeks", category: "efficacy", k: 5, fix: "71% लोगों को 4 हफ्तों में" }),
    ];
    const rows: DriftRow[] = [
      { kind: "new_belief", category: "guarantee", master: null, variant: { belief: "The glow is guaranteed", quote: "पक्का निखार", strength: 3, readers: 6 }, explanation: "पक्का means “certain” or “guaranteed”; the English never promises a result.", fix: "निखार दिख सकता है" },
      { kind: "strengthened", category: "efficacy", master: { belief: "71% of users saw more radiant skin after 4 weeks", quote: "71% saw more radiant skin in 4 weeks", strength: 2, readers: 6 }, variant: { belief: "Everyone gets glowing skin within 4 weeks", quote: "4 हफ्तों में पक्का निखार", strength: 3, readers: 5 }, explanation: "The Hindi drops “71% saw” and adds पक्का, so the result reads as certain for everyone.", fix: "71% लोगों को 4 हफ्तों में" },
      { kind: "same", category: "health", master: { belief: "Gentle enough to use every day", quote: "Gentle enough for daily use", strength: 2, readers: 5 }, variant: { belief: "Gentle enough to use every day", quote: "रोज़ इस्तेमाल के लिए सौम्य", strength: 2, readers: 5 }, explanation: "Same claim in both." },
      { kind: "same", category: "efficacy", master: { belief: "Results differ from person to person", quote: "*Results may vary.", strength: 1, readers: 3 }, variant: { belief: "Results differ from person to person", quote: "*परिणाम अलग हो सकते हैं।", strength: 1, readers: 3 }, explanation: "The disclaimer is translated faithfully." },
    ];
    const R146: SeedReader[] = [
      ["Urban working woman, 25-34", true, "A Vitamin C serum that will definitely make my skin glow in four weeks.", ["confident"], [["Glowing skin is certain in 4 weeks", "4 हफ्तों में पक्का निखार", "guarantee"]]],
      ["College student on a budget", true, "Pakka glow in a month, gentle for daily use.", ["confident", "salesy"], [["The glow is guaranteed", "पक्का निखार", "guarantee"]]],
      ["Skin-concern-focused reader, 35+", true, "Promises a sure glow in 4 weeks; the fine print says results vary, which contradicts it.", ["overpromising"], [["Results are guaranteed in 4 weeks", "4 हफ्तों में पक्का निखार", "guarantee"]]],
      ["builtin-literal", true, "Use it for 4 weeks and you will surely glow.", ["certain"], [["Everyone glows within 4 weeks", "4 हफ्तों में", "efficacy"]]],
      ["builtin-hindi", true, "पक्का निखार sounds like a promise: the glow will definitely come.", ["pushy"], [["A glow is promised", "पक्का निखार", "guarantee"]]],
      ["builtin-asci", false, "An absolute efficacy promise that the approved English claim does not make.", ["misleading"], [["Guaranteed result claim", "पक्का निखार", "guarantee"]]],
    ];
    const sum: CheckSummary = { ...summary(findings, 5, 52_800, 0, R146), drift: { master_id: "", master_number: 145, master_version: 1, master_lang: "en", master_body: MASTER_145, rows, of: 6 } };
    subs.push({ number: 146, title: "Website banner: Vitamin C results (Hindi)", channel: "website", lang: "hi", intent: "Most users see more radiant skin after four weeks of Velura Vitamin C serum.", status: "in_review", author: "agency", locked: [], master: 145, cites: [], ageDays: 3,
      versions: [{ n: 1, body, findings, summary: sum, ageDays: 3 }] });
  }
  {
    const body = "Velura வைட்டமின் C சீரம். 71% பேர் 4 வாரங்களில் சருமம் அதிக பொலிவாக இருப்பதைக் கண்டனர்.* தினசரி பயன்பாட்டுக்கு மென்மையானது.\n*முடிவுகள் மாறுபடலாம்.";
    const rows: DriftRow[] = [
      { kind: "same", category: "efficacy", master: { belief: "71% of users saw more radiant skin after 4 weeks", quote: "71% saw more radiant skin in 4 weeks", strength: 2, readers: 6 }, variant: { belief: "71% of users saw more radiant skin after 4 weeks", quote: "71% பேர் 4 வாரங்களில் சருமம் அதிக பொலிவாக இருப்பதைக் கண்டனர்", strength: 2, readers: 6 }, explanation: "The percentage and the timeframe are kept." },
      { kind: "same", category: "health", master: { belief: "Gentle enough to use every day", quote: "Gentle enough for daily use", strength: 2, readers: 5 }, variant: { belief: "Gentle enough to use every day", quote: "தினசரி பயன்பாட்டுக்கு மென்மையானது", strength: 2, readers: 5 }, explanation: "Same claim in both." },
      { kind: "same", category: "efficacy", master: { belief: "Results differ from person to person", quote: "*Results may vary.", strength: 1, readers: 3 }, variant: { belief: "Results differ from person to person", quote: "*முடிவுகள் மாறுபடலாம்.", strength: 1, readers: 3 }, explanation: "The disclaimer is translated faithfully." },
    ];
    const sum: CheckSummary = { ...summary([], 6, 47_900), drift: { master_id: "", master_number: 145, master_version: 1, master_lang: "en", master_body: MASTER_145, rows, of: 6 } };
    subs.push({ number: 147, title: "Website banner: Vitamin C results (Tamil)", channel: "website", lang: "ta", intent: "Most users see more radiant skin after four weeks of Velura Vitamin C serum.", status: "draft", author: "creator", locked: [], master: 145, cites: [], ageDays: 2,
      versions: [{ n: 1, body, findings: [], summary: sum, ageDays: 2 }] });
  }

  return subs;
}

// ------------------------------------------------------------------ main

export async function seedDemo(
  client: SupabaseClient,
  opts: { password: string; image: Buffer | null; log?: (line: string) => void; refreshUsers?: boolean },
): Promise<{ submissions: number }> {
  admin = client;
  PASSWORD = opts.password;
  log = opts.log ?? (() => undefined);
  log("Seeding Velura...");

  // brand
  const found = must(await admin.from("brands").select("id").eq("name", "Velura").limit(1), "brand lookup");
  let brandId: string;
  if (found.length) {
    brandId = found[0].id;
    must(await admin.from("brands").update({ voice_traits: VOICE, palette: PALETTE }).eq("id", brandId), "brand update");
  } else {
    brandId = must(await admin.from("brands").insert({ name: "Velura", voice_traits: VOICE, palette: PALETTE }).select("id").single(), "brand insert").id;
  }
  log("  brand Velura");

  const users = await ensureUsers(brandId, opts.refreshUsers ?? true);

  // clauses, terms, personas
  must(await admin.from("clauses").upsert(
    CLAUSES.map((c) => ({ brand_id: brandId, ...c, confirmed: true })), { onConflict: "brand_id,code" }), "clauses");
  must(await admin.from("terms").upsert(
    TERMS.map((t) => ({ brand_id: brandId, kind: t.kind, phrase: t.phrase, replacement: t.replacement, clause_code: t.clause_code, triggers: t.triggers ?? null })),
    { onConflict: "brand_id,kind,phrase" }), "terms");
  must(await admin.from("personas").upsert(
    PERSONAS.map((p) => ({ brand_id: brandId, ...p, builtin: false })), { onConflict: "brand_id,name" }), "personas");
  log(`  ${CLAUSES.length} clauses, ${TERMS.length} terms, ${PERSONAS.length} personas`);

  // facts (+ embeddings when a key is available)
  must(await admin.from("facts").upsert(
    FACTS.map((f) => ({
      brand_id: brandId, code: f.code, statement: f.statement, source: f.source, owner: f.owner,
      expires_on: f.expires === null ? null : dateFromNow(f.expires), version: f.version,
      status: f.status ?? "active",
    })), { onConflict: "brand_id,code" }), "facts");
  const embedded = new Set(
    must(await admin.from("facts").select("code").eq("brand_id", brandId).not("embedding", "is", null), "embedded facts").map((r: { code: string }) => r.code));
  let nEmb = 0;
  for (const f of FACTS) {
    if (embedded.has(f.code)) continue;
    const v = await embedText(f.statement, TERMS.filter((t) => t.kind === "embargo").map((t) => t.phrase));
    if (!v) break; // no key: skip gracefully
    must(await admin.from("facts").update({ embedding: toVectorLiteral(v) }).eq("brand_id", brandId).eq("code", f.code), `embed ${f.code}`);
    nEmb++;
  }
  log(`  ${FACTS.length} facts (${nEmb} newly embedded${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "" : "; no GOOGLE_GENERATIVE_AI_API_KEY, embeddings skipped"})`);

  // demo image
  const imagePath = `${users.agency.id}/velura-142.png`;
  let imageUploaded = false;
  if (opts.image) {
    const up = await admin.storage.from("assets").upload(imagePath, opts.image, { contentType: "image/png", upsert: true });
    if (up.error) log(`  image upload failed (run the migration first?): ${up.error.message}`);
    else imageUploaded = true;
  } else log("  public/demo/velura-142.png missing; run: pnpm tsx scripts/make-demo-image.ts");

  // submissions
  // translations need migration 0003 (master_id, Tamil/Marathi); without it they are skipped with a warning
  const migrated = !(await admin.from("submissions").select("master_id").limit(1)).error;
  const subs = buildSubmissions().filter((s) => migrated || !s.master);
  if (!migrated) log("  translations #146-147 skipped: run supabase/migrations/0003_round3.sql, then seed again");
  const subIds = new Map<number, string>();
  const verHash = new Map<string, string>();
  for (const s of subs) {
    const masterId = s.master ? subIds.get(s.master)! : null;
    const row = must(await admin.from("submissions").upsert({
      brand_id: brandId, number: s.number, title: s.title, channel: s.channel, lang: s.lang, intent: s.intent,
      status: s.status, author_id: users[s.author].id, locked_phrases: s.locked, published_url: s.url ?? null,
      created_at: daysFromNow(-s.ageDays), updated_at: daysFromNow(-Math.max(0, s.ageDays - 1)),
      ...(migrated ? { master_id: masterId } : {}),
    }, { onConflict: "number" }).select("id").single(), `submission ${s.number}`);
    subIds.set(s.number, row.id);
    // a reset removes versions visitors added on top of the seeded ones
    must(await admin.from("versions").delete().eq("submission_id", row.id).gt("n", s.versions.length), `trim versions ${s.number}`);

    for (const v of s.versions) {
      if (v.summary.drift && masterId) v.summary.drift.master_id = masterId;
      const hash = sha(`${v.body}\n${v.image ? "velura-142" : ""}\n${v.alt ?? ""}`);
      verHash.set(`${s.number}:${v.n}`, hash);
      must(await admin.from("versions").upsert({
        submission_id: row.id, n: v.n, body: v.body,
        image_path: v.image && imageUploaded ? imagePath : null, image_alt: v.alt ?? null,
        content_hash: hash, findings: v.findings, summary: v.summary, created_at: daysFromNow(-v.ageDays),
      }, { onConflict: "submission_id,n" }), `version ${s.number}.${v.n}`);
    }
  }
  const ids = [...subIds.values()];
  // reset child rows so re-runs don't duplicate
  must(await admin.from("comments").delete().in("submission_id", ids), "clear comments");
  must(await admin.from("fact_citations").delete().in("submission_id", ids), "clear citations");
  const cites = subs.flatMap((s) => s.cites.map((c) => ({ submission_id: subIds.get(s.number)!, fact_code: c.code, fact_version: c.version })));
  if (cites.length) must(await admin.from("fact_citations").insert(cites), "citations");
  log(`  ${subs.length} submissions, ${cites.length} fact citations`);

  // demo storefront pages (migration 0003): the published demo posts link to them, so recall checks can fetch them
  {
    const { error } = await admin.from("live_pages").upsert(
      Object.entries(DEMO_PAGES).map(([slug, p]) => ({ slug, brand_id: brandId, title: p.title, body: p.body })), { onConflict: "slug" });
    log(error ? `  demo store pages skipped (${error.message})` : `  ${Object.keys(DEMO_PAGES).length} demo store pages`);
  }

  // comments
  const S = (n: number) => subIds.get(n)!;
  const v1 = subs.find((s) => s.number === 140)!.versions[0].body;
  const v142 = subs.find((s) => s.number === 142)!.versions[0].body;
  const v141 = subs.find((s) => s.number === 141)!.versions[0].body;
  const comments = [
    { n: 139, ver: 1, who: "reviewer" as Role, body: "Approved. The Nykaa ranking export is attached to F-10; note the ranking only covers January to March 2026.", anchor: null, age: 20 },
    { n: 140, ver: 1, who: "reviewer" as Role, body: "“Guaranteed” and “chemical-free” both break the guidelines (G-06, G-01). Also confirm the Diwali end date with Marketing.", anchor: sp(v1, "Guaranteed"), age: 8 },
    { n: 140, ver: 1, who: "agency" as Role, body: "Understood. The offer does end tonight per Marketing; I will rewrite and send v2.", anchor: null, age: 8 },
    { n: 140, ver: 2, who: "reviewer" as Role, body: "Much better. I still need the offer recorded as a ledger fact with its end date before I can approve.", anchor: null, age: 5 },
    { n: 141, ver: 1, who: "creator" as Role, body: "This is a teaser only, no product claims.", anchor: null, age: 3 },
    { n: 141, ver: 1, who: "reviewer" as Role, body: "The product name is embargoed until the launch brief goes out. Please remove it.", anchor: sp(v141, "Velura Nightshift"), age: 3 },
    { n: 142, ver: 1, who: "reviewer" as Role, body: "Lab coat plus “Dermatologist-loved” reads as a doctor's endorsement to half the readers. Needs a decision.", anchor: sp(v142, "Dermatologist-loved"), age: 1 },
    { n: 142, ver: 1, who: "agency" as Role, body: "The lab coat is in the approved brief. Happy to swap the headline to “Dermatologist-tested”.", anchor: null, age: 1 },
    { n: 144, ver: 1, who: "owner" as Role, body: "Recalled: clinical and dermatologist claims were not substantiated. Do not repost.", anchor: null, age: 14 },
    ...(subIds.has(146) ? [{ n: 146, ver: 1, who: "reviewer" as Role, body: "पक्का reads as a guarantee, and the 71% has disappeared. Please match the English master (#145).", anchor: sp(subs.find((x) => x.number === 146)!.versions[0].body, "पक्का निखार"), age: 2 }] : []),
  ].map((c) => ({ submission_id: S(c.n), version_n: c.ver, author_id: users[c.who].id, body: c.body, anchor: c.anchor, created_at: daysFromNow(-c.age) }));
  must(await admin.from("comments").insert(comments), "comments");
  log(`  ${comments.length} comments`);

  // audit log (append-only: only seed once)
  const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("detail->>seed", "true");
  // submissions added to the seed later (e.g. the Round 3 translations) still get their own history
  const { data: had } = await admin.from("audit_log").select("submission_id").in("submission_id", ids);
  const hasAudit = new Set((had ?? []).map((r: { submission_id: string }) => r.submission_id));
  const seededBefore = (count ?? 0) > 0;
  const auditSubs = seededBefore ? subs.filter((s) => !hasAudit.has(subIds.get(s.number)!)) : subs;
  if (seededBefore && !auditSubs.length) {
    log(`  audit log already seeded (${count} entries), skipping`);
  } else {
    const actor = (r: Role) => ({ actor_id: users[r].id, actor_name: users[r].name, actor_role: r });
    const fv = (s: SeedSub) => Object.fromEntries(s.cites.map((c) => [c.code, c.version]));
    const ev: { t: number; row: Record<string, unknown> }[] = [];
    const push = (ageDays: number, submission: number | null, who: Role, action: string, detail: Record<string, unknown> = {}, extra: { v?: number; facts?: Record<string, number> | null } = {}) => {
      const s = submission ? subs.find((x) => x.number === submission)! : null;
      ev.push({
        t: Date.now() - ageDays * DAY,
        row: {
          submission_id: submission ? subIds.get(submission) : null, ...actor(who), action, detail: { seed: true, ...detail },
          version_hash: s && extra.v ? verHash.get(`${s.number}:${extra.v}`) : null,
          fact_versions: extra.facts === undefined ? (s ? fv(s) : null) : extra.facts,
          created_at: new Date(Date.now() - ageDays * DAY).toISOString(),
        },
      });
    };
    if (!seededBefore) {
      for (const f of FACTS.filter((x) => ["F-03", "F-07", "F-12", "F-10"].includes(x.code))) {
        push(60, null, "owner", "fact_created", { code: f.code, to_version: 1 }, { facts: { [f.code]: 1 } });
      }
      push(40, null, "owner", "fact_edited", { code: "F-03", from_version: 1, to_version: 2, status: "active" }, { facts: { "F-03": 2 } });
      push(12, null, "owner", "fact_edited", { code: "F-12", from_version: 1, to_version: 2, status: "active", note: "Re-ran ISO 16128 calculation with new supplier data" }, { facts: { "F-12": 2 } });
    }
    for (const s of auditSubs) {
      const who = s.author;
      push(s.ageDays, s.number, who, "submission_created", { title: s.title, version: 1, ...(s.master ? { translation_of: s.master, lang: s.lang } : {}) }, { v: 1, facts: null });
      for (const v of s.versions) {
        if (v.n > 1) push(v.ageDays, s.number, who, "version_added", { version: v.n }, { v: v.n, facts: null });
        push(v.ageDays - 0.01, s.number, who, "check_run", { version: v.n, rule_count: v.summary.rule_count, ai_count: v.summary.ai_count, high: v.summary.high, mode: "cloud", model: MODEL }, { v: v.n });
      }
      const last = s.versions[s.versions.length - 1].n;
      const age = Math.max(0.2, s.versions[s.versions.length - 1].ageDays - 0.3);
      if (s.status !== "draft") push(age, s.number, who, "submitted_for_review", { from: "draft", to: "in_review" }, { v: last });
      if (s.status === "changes_requested") push(age - 0.1, s.number, "reviewer", "requested_changes", { from: "in_review", to: "changes_requested", note: "See comments: guarantee wording and offer dates." }, { v: last });
      if (["approved", "published", "recalled"].includes(s.status)) push(age - 0.2, s.number, "reviewer", "approved", { from: "in_review", to: "approved" }, { v: last });
      if (["published", "recalled"].includes(s.status)) push(age - 0.25, s.number, "creator", "published_url_recorded", { url: s.url, from: "approved", to: "published" }, { v: last });
      if (s.status === "recalled") push(14, s.number, "owner", "recalled", { from: "published", to: "recalled", note: "Unsubstantiated clinical claims." }, { v: last });
    }
    if (!seededBefore) {
      push(6, 139, "owner", "recall_enqueued", { fact_code: "F-10", reason: "F-10 expired" }, { facts: { "F-10": 1 } });
      push(12, 138, "owner", "recall_enqueued", { fact_code: "F-12", reason: "F-12 changed (cited v1, now v2)" }, { facts: { "F-12": 2 } });
    }

    ev.sort((a, b) => a.t - b.t);
    // insert in chronological order; the DB trigger assigns ids and chains hashes in that order
    must(await admin.from("audit_log").insert(ev.map((e) => e.row)), "audit_log");
    log(`  ${ev.length} audit entries`);
  }

  const { data: chain } = await admin.rpc("verify_audit_chain");
  const c0 = Array.isArray(chain) ? chain[0] : chain;
  log(`Audit chain: ${c0?.ok ? "intact" : `BROKEN at ${c0?.broken_at}`}`);
  // recall checks and closures recorded before this point belong to the old demo state (see recall/queue.ts)
  must(await admin.from("audit_log").insert({ actor_id: null, actor_name: "Readback scheduler", actor_role: "system", action: "demo_reset", detail: { submissions: subs.length } }), "demo_reset audit");
  log("Done. Sign in at / with the 'Enter as' buttons.");
  return { submissions: subs.length };
}

