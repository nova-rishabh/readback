// Pure grounding guard: fuzzy-locate a reader's trigger_quote inside the draft (token overlap or Levenshtein).
import type { Span } from "../types";

interface Tok {
  w: string;
  start: number;
  end: number;
}

export function tokenize(s: string): Tok[] {
  return [...s.matchAll(/[\p{L}\p{N}%]+/gu)].map((m) => ({
    w: m[0].toLowerCase(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

export const normalize = (s: string) => tokenize(s).map((t) => t.w).join(" ");

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function levenshteinRatio(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

/** Share of quote tokens present in the window (multiset). */
export function tokenOverlap(quote: string[], window: string[]): number {
  if (!quote.length) return 0;
  const pool = new Map<string, number>();
  window.forEach((w) => pool.set(w, (pool.get(w) ?? 0) + 1));
  let hit = 0;
  for (const q of quote) {
    const n = pool.get(q) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(q, n - 1);
    }
  }
  return hit / quote.length;
}

export type Located = Span & { score: number };

/** Best-matching draft span for the quote, or null when nothing reaches the threshold. */
export function locateQuote(draft: string, quote: string, threshold = 0.8): Located | null {
  const q = tokenize(quote).map((t) => t.w);
  const d = tokenize(draft);
  if (!q.length || !d.length) return null;
  const qs = q.join(" ");
  let best: { i: number; len: number; score: number } | null = null;
  for (const len of [q.length, q.length - 1, q.length + 1]) {
    if (len < 1 || len > d.length) continue;
    for (let i = 0; i + len <= d.length; i++) {
      const win = d.slice(i, i + len).map((t) => t.w);
      const score = Math.max(tokenOverlap(q, win), levenshteinRatio(qs, win.join(" ")));
      if (!best || score > best.score + 1e-9) best = { i, len, score };
    }
  }
  if (!best || best.score < threshold) return null;
  const start = d[best.i].start;
  const end = d[best.i + best.len - 1].end;
  return { start, end, text: draft.slice(start, end), score: best.score };
}
