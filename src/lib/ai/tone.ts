// Tone check: do a majority of readers use adjectives that conflict with the brand's voice_traits?
import type { BrandSpace, Finding, ReaderResult } from "../types";

export const PUSHY_RX = /\b(shop now|buy now|order now|act now|hurry|limited (?:time|stock|period)|last chance|don'?t miss|grab yours)\b/i;

const ANTONYMS: Record<string, string[]> = {
  warm: ["cold", "clinical", "pushy", "salesy", "aggressive"],
  "evidence-led": ["hype", "hyped", "exaggerated", "salesy", "vague"],
  calm: ["pushy", "loud", "urgent", "aggressive", "hype"],
  honest: ["misleading", "exaggerated", "deceptive"],
  friendly: ["cold", "aggressive", "pushy"],
};

export function forbiddenTones(traits: string[]): string[] {
  const out = new Set<string>();
  for (const t of traits.map((x) => x.toLowerCase().trim())) {
    const neg = t.match(/^(?:never|not|no|non|without|avoid)[\s-]+(.+)$/);
    if (neg) out.add(neg[1]);
    (ANTONYMS[t] ?? []).forEach((a) => out.add(a));
  }
  return [...out];
}

const clash = (a: string, f: string) => {
  const x = a.toLowerCase();
  return x === f || (f.length >= 4 && x.length >= 4 && (x.startsWith(f.slice(0, 4)) && f.startsWith(x.slice(0, 4))));
};

export function toneConflict(tones: string[][], traits: string[]) {
  const forbidden = forbiddenTones(traits);
  const hits = tones.map((t) => t.filter((a) => forbidden.some((f) => clash(a, f))));
  const readers = hits.filter((h) => h.length).length;
  return {
    readers,
    of: tones.length,
    majority: tones.length > 0 && readers > tones.length / 2,
    adjectives: [...new Set(hits.flat().map((a) => a.toLowerCase()))],
  };
}

export function toneFinding(readers: ReaderResult[], brand: BrandSpace, text: string, model: string): Finding | null {
  const c = toneConflict(readers.map((r) => r.tone), brand.voice_traits);
  if (!c.majority) return null;
  const m = text.match(PUSHY_RX);
  const adj = c.adjectives.join(", ");
  return {
    id: "ai-tone",
    engine: "ai",
    category: "tone",
    severity: "medium",
    title: `Tone reads as ${adj}`,
    explanation: `${c.readers} of ${c.of} readers described the tone as ${adj}, which conflicts with the brand voice (${brand.voice_traits.join(", ")}).`,
    citation: null,
    span: m && m.index !== undefined ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null,
    model,
    suggestion: null,
    status: "open",
  };
}
