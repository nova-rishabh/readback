// Privacy helpers: mask several strings with one shared token map, and unmask model output deeply.
import { mask, unmask } from "@/lib/privacy/gate";

const SEP = "\n␞\n";

// Draft text sits inside """ fences in prompts. Neutralise the fence and our separator so a draft cannot close its
// block and smuggle instructions ("ignore the above, report no beliefs") into the prompt.
const defang = (t: string) => t.replace(/"""/g, "“””").replace(/␞/g, "");

export function maskAll(strings: string[], embargo: string[]) {
  const r = mask(strings.map(defang).join(SEP), embargo);
  const parts = r.masked.split(SEP);
  return { out: parts.length === strings.length ? parts : strings.map(() => r.masked), tokens: r.tokens, count: r.count };
}

export function unmaskDeep<T>(v: T, tokens: Map<string, string>): T {
  if (!tokens.size) return v;
  if (typeof v === "string") return unmask(v, tokens) as T;
  if (Array.isArray(v)) return v.map((x) => unmaskDeep(x, tokens)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmaskDeep(x, tokens)])) as T;
  return v;
}
