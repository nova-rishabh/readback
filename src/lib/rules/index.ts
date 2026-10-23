// Rule Engine: deterministic term, disclaimer, accessibility and palette checks over a draft.
import type { BrandSpace, Channel, Finding, Term } from "@/lib/types";
import { AhoCorasick, type AcMatch } from "./aho-corasick";
import { deltaE2000, hexToRgb, rgbToHex, rgbToLab } from "./color";
import { boxContrast, dominantColors } from "./pixels";

export interface RunRulesInput {
  text: string;
  image?: Buffer | null;
  imageAlt?: string | null;
  textBoxes?: { text: string; box: [number, number, number, number] }[];
  brand: BrandSpace;
  channel: Channel;
}

const WCAG_TEXT = { kind: "wcag" as const, code: "1.4.3", text: "Contrast (Minimum)" };
const ALT_TEXT = { kind: "wcag" as const, code: "1.1.1", text: "Non-text Content" };

function citeTerm(t: Term, brand: BrandSpace): Finding["citation"] {
  if (!t.clause_code) return null;
  const c = brand.clauses.find((x) => x.code === t.clause_code);
  return { kind: "clause", code: t.clause_code, text: c?.title ?? t.phrase };
}

const base = (f: Partial<Finding> & Pick<Finding, "id" | "category" | "severity" | "title" | "explanation" | "citation" | "span">): Finding =>
  ({ engine: "rule", model: null, suggestion: null, status: "open", ...f }) as Finding;

function termFindings(text: string, brand: BrandSpace): Finding[] {
  const terms = brand.terms.filter((t) => t.kind === "banned" || t.kind === "preferred" || t.kind === "embargo");
  const hits: AcMatch[] = new AhoCorasick(terms.map((t) => t.phrase)).search(text);
  // Drop matches strictly contained in a longer one; dedupe identical spans.
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const h of kept) {
    const t = terms[h.index];
    const key = `${t.kind}:${h.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const span = { start: h.start, end: h.end, text: text.slice(h.start, h.end) };
    if (t.kind === "embargo") {
      out.push(base({
        id: `rule-embargo-${h.start}-${h.end}`, category: "embargo", severity: "high",
        title: `Embargoed term: “${span.text}”`,
        explanation: `“${span.text}” is embargoed and must not appear in published copy yet.`,
        citation: citeTerm(t, brand), span,
      }));
    } else if (t.kind === "banned") {
      out.push(base({
        id: `rule-banned-${h.start}-${h.end}`, category: "terminology", severity: "high",
        title: `Banned term: “${span.text}”`,
        explanation: `The brand guidelines do not allow “${span.text}”.` + (t.replacement ? ` Use “${t.replacement}” instead.` : ""),
        citation: citeTerm(t, brand), span,
        suggestion: t.replacement ? { replacement: t.replacement, rationale: `Approved alternative for “${t.phrase}”.`, reread: null } : null,
      }));
    } else if (t.replacement) {
      // A preferred entry with a replacement means: this wording is discouraged, use the replacement. Without one it is approved wording.
      out.push(base({
        id: `rule-preferred-${h.start}-${h.end}`, category: "terminology", severity: "low",
        title: `Preferred wording: “${t.replacement}”`,
        explanation: `The brand prefers “${t.replacement}” over “${span.text}”.`,
        citation: citeTerm(t, brand), span,
        suggestion: { replacement: t.replacement, rationale: "Brand-preferred wording.", reread: null },
      }));
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[*\s]+/g, " ").trim();

function disclaimerFindings(text: string, brand: BrandSpace): Finding[] {
  const out: Finding[] = [];
  for (const t of brand.terms.filter((x) => x.kind === "disclaimer")) {
    if (norm(text).includes(norm(t.phrase))) continue;
    const triggers = (t.triggers ?? []).flatMap((x) => x.split("|")).map((x) => x.trim()).filter(Boolean);
    const m = new AhoCorasick(triggers).search(text)[0];
    if (!m) continue;
    const span = { start: m.start, end: m.end, text: text.slice(m.start, m.end) };
    out.push(base({
      id: `rule-disclaimer-${m.start}`, category: "disclaimer", severity: "medium",
      title: `Missing disclaimer: “${t.phrase}”`,
      explanation: `The copy says “${span.text}”, which requires the disclaimer “${t.phrase}”, but the disclaimer is missing.`,
      citation: citeTerm(t, brand), span,
    }));
  }
  return out;
}

const FILENAME_ALT = /\.(png|jpe?g|gif|webp|svg|avif|heic)$|^(img|image|dsc|screenshot|photo)[-_ ]?\d+/i;

function altFinding(alt: string | null | undefined): Finding | null {
  const a = (alt ?? "").trim();
  const problem = !a ? "has no alt text" : FILENAME_ALT.test(a) ? `uses a filename (“${a}”) as alt text` : null;
  if (!problem) return null;
  return base({
    id: "rule-accessibility-alt", category: "accessibility", severity: "medium",
    title: "Image alt text missing or meaningless",
    explanation: `The image ${problem}. Screen-reader users get no description of what the image shows.`,
    citation: ALT_TEXT, span: null,
  });
}

async function contrastFindings(input: RunRulesInput, image: Buffer): Promise<Finding[]> {
  const out: Finding[] = [];
  const boxes = input.textBoxes ?? [];
  for (let i = 0; i < boxes.length; i++) {
    const { text: bt, box } = boxes[i];
    const r = await boxContrast(image, box);
    if (!r) continue;
    const required = box[3] > 0.08 ? 3 : 4.5;
    if (r.ratio >= required) continue;
    const idx = bt ? input.text.toLowerCase().indexOf(bt.toLowerCase()) : -1;
    const span = idx >= 0 ? { start: idx, end: idx + bt.length, text: input.text.slice(idx, idx + bt.length) } : null;
    const ratio = Math.round(r.ratio * 100) / 100;
    out.push(base({
      id: span ? `rule-accessibility-${span.start}-${i}` : `rule-accessibility-box-${i}`,
      category: "accessibility", severity: ratio < 3 ? "high" : "medium",
      title: `Low contrast: “${bt}”`,
      explanation: `The text “${bt}” has a contrast ratio of ${ratio}:1 against its background; ${required}:1 is required for ${required === 3 ? "large" : "normal"} text.`,
      citation: WCAG_TEXT, span,
      measured: { ratio, fg: rgbToHex(r.fg), bg: rgbToHex(r.bg), required },
    }));
  }
  return out;
}

async function paletteFindings(input: RunRulesInput, image: Buffer): Promise<Finding[]> {
  const pal = input.brand.palette.map((p) => rgbToLab(hexToRgb(p.hex)));
  if (!pal.length) return [];
  const clause = input.brand.clauses.find((c) => /palette|colou?r/i.test(c.title));
  const out: Finding[] = [];
  for (const d of await dominantColors(image)) {
    if (d.share <= 0.08) continue;
    const dists = pal.map((p) => deltaE2000(rgbToLab(d.rgb), p));
    const de = Math.min(...dists);
    if (de <= 20) continue;
    const nearest = input.brand.palette[dists.indexOf(de)].name;
    const hex = rgbToHex(d.rgb);
    out.push(base({
      id: `rule-visual-${hex.slice(1).toLowerCase()}`, category: "visual", severity: "low",
      title: `Off-palette colour ${hex}`,
      explanation: `${Math.round(d.share * 100)}% of the image is close to ${hex}, which is far from every brand palette colour; nearest is ${nearest} (ΔE ${de.toFixed(1)}, limit 20).`,
      citation: clause ? { kind: "clause", code: clause.code, text: clause.title } : { kind: "clause", code: "PALETTE", text: "Brand palette" },
      span: null,
      measured: { color: hex, share: Math.round(d.share * 100) / 100, delta_e: Math.round(de * 10) / 10, nearest },
    }));
  }
  return out;
}

export async function runRules(input: RunRulesInput): Promise<Finding[]> {
  const findings = [...termFindings(input.text, input.brand), ...disclaimerFindings(input.text, input.brand)];
  if (input.image) {
    const alt = altFinding(input.imageAlt);
    if (alt) findings.push(alt);
    findings.push(...(await contrastFindings(input, input.image)), ...(await paletteFindings(input, input.image)));
  }
  return findings;
}
