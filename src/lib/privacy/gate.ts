// Privacy Gate: replaces PII and embargoed terms with ⟦KIND_n⟧ tokens before any model call; unmask reverses it.
import { AhoCorasick } from "@/lib/rules/aho-corasick";

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "PAN", re: /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/g },
  { kind: "CARD", re: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g }, // kept only if it passes the Luhn check
  { kind: "AADHAAR", re: /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g },
  { kind: "PHONE", re: /(?<![\w+])(?:\+91[ -]?|91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g },
];

interface Hit { start: number; end: number; kind: string }

/** Luhn checksum, so ordinary long numbers (order ids, batch codes) are not masked as cards. */
function luhn(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

export function mask(text: string, embargo: string[]): { masked: string; tokens: Map<string, string>; count: number } {
  const hits: Hit[] = [];
  for (const { kind, re } of PATTERNS)
    for (const m of text.matchAll(re)) if (kind !== "CARD" || luhn(m[0])) hits.push({ start: m.index!, end: m.index! + m[0].length, kind });
  const terms = embargo.filter((t) => t.trim());
  if (terms.length) for (const m of new AhoCorasick(terms).search(text)) hits.push({ start: m.start, end: m.end, kind: "EMBARGO" });

  // Resolve overlaps: earliest start wins, then the longest span.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen: Hit[] = [];
  for (const h of hits) if (!chosen.length || h.start >= chosen[chosen.length - 1].end) chosen.push(h);

  const tokens = new Map<string, string>(); // token -> original
  const byOriginal = new Map<string, string>(); // kind|original -> token (same value reuses its token)
  const counters: Record<string, number> = {};
  let masked = "";
  let pos = 0;
  for (const h of chosen) {
    const orig = text.slice(h.start, h.end);
    const key = `${h.kind}|${orig}`;
    let tok = byOriginal.get(key);
    if (!tok) {
      tok = `⟦${h.kind}_${(counters[h.kind] = (counters[h.kind] ?? 0) + 1)}⟧`;
      byOriginal.set(key, tok);
      tokens.set(tok, orig);
    }
    masked += text.slice(pos, h.start) + tok;
    pos = h.end;
  }
  masked += text.slice(pos);
  return { masked, tokens, count: chosen.length };
}

export function unmask(text: string, tokens: Map<string, string>): string {
  let out = text;
  for (const [tok, orig] of tokens) out = out.split(tok).join(orig);
  return out;
}
