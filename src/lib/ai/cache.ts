// In-memory LRU keyed on a hash of text + image + brand facts version (+ intent, locks, channel, mode).
import { createHash } from "node:crypto";
import type { BrandSpace } from "../types";

export class LRU<V> {
  private m = new Map<string, V>();
  constructor(private max = 50) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  clear() {
    this.m.clear();
  }
}

export function contentHash(p: {
  text: string; intent: string; lang: string; channel: string; imageAlt?: string | null;
  lockedPhrases: string[]; image?: { data: Buffer } | null; brand: BrandSpace; mode: string;
}): string {
  const h = createHash("sha256");
  const factsVersion = p.brand.facts.map((f) => `${f.code}:${f.version}:${f.status}`).sort().join(",");
  h.update(JSON.stringify([p.text, p.intent, p.lang, p.channel, p.imageAlt ?? "", p.lockedPhrases, factsVersion, p.brand.voice_traits, p.mode]));
  if (p.image) h.update(p.image.data);
  return h.digest("hex");
}
