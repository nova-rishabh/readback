// Pure belief grouping: greedy cosine clustering over belief embeddings, plus selection and split labelling.
import type { BeliefCategory, Span } from "../types";

export interface BeliefItem {
  reader: string; // persona id
  reader_name: string;
  belief: string;
  category: BeliefCategory;
  quote: string;
  span: Span | null;
  visual: string | null;
  embedding: number[];
}

export interface BeliefGroup {
  items: BeliefItem[];
  centroid: number[];
  statement: string; // belief closest to the centroid
  readerIds: string[]; // distinct readers
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Share of the shorter span covered by the other one (0 when either is missing). */
export function spanOverlap(a: Span | null, b: Span | null): number {
  if (!a || !b) return 0;
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return inter > 0 ? inter / Math.max(1, Math.min(a.end - a.start, b.end - b.start)) : 0;
}

/**
 * Beliefs of the same category triggered by overlapping words (half the shorter quote or more), as index groups.
 * They are one belief in different words, so each group is embedded once: far fewer embedding requests per check,
 * which matters on a free tier that counts every text as a request.
 */
export function anchorGroups(items: Pick<BeliefItem, "category" | "span">[]): number[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (items[i].category === items[j].category && spanOverlap(items[i].span, items[j].span) >= 0.5) parent[find(j)] = find(i);
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()];
}

/**
 * Greedy grouping. A belief joins a group when its embedding is close to the group's (cosine >= threshold), or when
 * it is the same kind of belief triggered by the same words: a member of the same category whose quoted span
 * overlaps it by half or more, with a looser similarity floor. Readers paraphrase one claim in many ways
 * ("eliminates 99% of germs", "kills nearly all germs"); anchoring on the shared quote keeps them in one group,
 * which is what makes a check give the same answer run after run.
 */
export function clusterBeliefs(items: BeliefItem[], threshold = 0.82, anchoredFloor = 0.6): BeliefGroup[] {
  const acc: { items: BeliefItem[]; sum: number[] }[] = [];
  for (const it of items) {
    let best = -1, bestSim = -Infinity;
    acc.forEach((g, gi) => {
      const s = cosine(it.embedding, g.sum);
      const anchored = g.items.some((m) => m.category === it.category && spanOverlap(m.span, it.span) >= 0.5 && cosine(m.embedding, it.embedding) >= anchoredFloor);
      if ((s >= threshold || anchored) && s > bestSim) { best = gi; bestSim = s; }
    });
    if (best < 0) acc.push({ items: [it], sum: [...it.embedding] });
    else {
      acc[best].items.push(it);
      acc[best].sum = acc[best].sum.map((v, i) => v + it.embedding[i]);
    }
  }
  return acc.map((g) => {
    const centroid = g.sum.map((v) => v / g.items.length);
    const rep = g.items.reduce((a, b) => (cosine(b.embedding, centroid) > cosine(a.embedding, centroid) ? b : a));
    return { items: g.items, centroid, statement: rep.belief, readerIds: [...new Set(g.items.map((i) => i.reader))] };
  });
}

/** Keep groups held by >= minReaders distinct readers (capped by panel size), biggest first. */
export function selectGroups(groups: BeliefGroup[], panelSize: number, minReaders = 2): BeliefGroup[] {
  const min = Math.min(minReaders, Math.max(1, panelSize));
  return groups.filter((g) => g.readerIds.length >= min).sort((a, b) => b.readerIds.length - a.readerIds.length);
}

/** A 40-60% split of the panel is labelled ambiguous. */
export const isAmbiguous = (k: number, n: number) => n > 0 && k / n >= 0.4 && k / n <= 0.6;
