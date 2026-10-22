// Hand-written Aho-Corasick matcher: case-insensitive, word-boundary aware, returns spans into the original text.

export interface AcMatch {
  start: number; // char offset into the original text
  end: number; // exclusive
  index: number; // index of the pattern in the input array
  pattern: string;
}

interface Node {
  next: Map<string, number>;
  fail: number;
  out: number[]; // pattern indexes ending here (including via fail links)
}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
// Per-UTF-16-unit lowercase that never changes string length, so offsets stay valid.
const fold = (s: string) => s.replace(/[\s\S]/g, (c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c));

export class AhoCorasick {
  private nodes: Node[] = [{ next: new Map(), fail: 0, out: [] }];
  private folded: string[];
  private patterns: string[];

  constructor(patterns: string[]) {
    this.patterns = patterns;
    this.folded = patterns.map((p) => fold(p.trim()));
    this.folded.forEach((f, i) => {
      if (!f) return;
      let n = 0;
      for (const ch of f) {
        let nx = this.nodes[n].next.get(ch);
        if (nx === undefined) {
          nx = this.nodes.push({ next: new Map(), fail: 0, out: [] }) - 1;
          this.nodes[n].next.set(ch, nx);
        }
        n = nx;
      }
      this.nodes[n].out.push(i);
    });
    // BFS to build failure links
    const q: number[] = [...this.nodes[0].next.values()];
    while (q.length) {
      const u = q.shift()!;
      for (const [ch, v] of this.nodes[u].next) {
        let f = this.nodes[u].fail;
        while (f && !this.nodes[f].next.has(ch)) f = this.nodes[f].fail;
        const t = this.nodes[f].next.get(ch);
        this.nodes[v].fail = t !== undefined && t !== v ? t : 0;
        this.nodes[v].out.push(...this.nodes[this.nodes[v].fail].out);
        q.push(v);
      }
    }
  }

  /** All matches (overlaps included) that sit on word boundaries, sorted by start then length desc. */
  search(text: string): AcMatch[] {
    const hay = fold(text);
    const res: AcMatch[] = [];
    let n = 0;
    for (let i = 0; i < hay.length; i++) {
      const ch = hay[i];
      while (n && !this.nodes[n].next.has(ch)) n = this.nodes[n].fail;
      n = this.nodes[n].next.get(ch) ?? 0;
      for (const idx of this.nodes[n].out) {
        const p = this.folded[idx];
        const end = i + 1;
        const start = end - p.length;
        // Boundary only matters where the pattern edge is itself a word character.
        if (isWord(p[0]) && isWord(hay[start - 1])) continue;
        if (isWord(p[p.length - 1]) && isWord(hay[end])) continue;
        res.push({ start, end, index: idx, pattern: this.patterns[idx] });
      }
    }
    return res.sort((a, b) => a.start - b.start || b.end - a.end);
  }
}
