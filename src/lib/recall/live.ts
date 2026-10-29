// Live Fact Recall, the page half: fetch a recorded live URL safely, reduce it to text, and decide whether the
// stale claim is still on it. Pure helpers are exported for tests; fetchLivePage is the only network entry point.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Finding } from "../types";
import { locateQuote, tokenize } from "../ai/grounding";

// inconclusive: the page loaded but cannot prove the claim is gone (no wording to look for, or almost no readable text)
export type LiveOutcome = "still_live" | "removed" | "unreachable" | "inconclusive";

export interface LiveCheck {
  outcome: LiveOutcome;
  url: string;
  http: number | null;
  matched: string[]; // claim phrases still found on the page
  looked_for: string[];
  error?: string;
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;

/** Loopback, private, link-local, CGNAT and other non-public ranges: never fetched (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links can be checked");
  if (url.username || url.password) throw new Error("Links with credentials are not checked");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That address is not a public website");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** Visible text of an HTML page: scripts, styles and tags removed, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h\d|tr|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * The words in the approved copy that relied on a fact: spans of findings that cite it. When no finding carries a
 * span, fall back to sentences of the copy that share the fact's numbers or distinctive words.
 */
export function claimPhrases(findings: Finding[], factCode: string, body: string, factStatement: string): string[] {
  const out = new Set<string>();
  for (const f of findings) {
    const cites = (f.citation?.kind === "fact" && f.citation.code === factCode) || f.belief?.fact_code === factCode;
    if (cites && f.span?.text && tokenize(f.span.text).length >= 2) out.add(f.span.text.trim());
  }
  if (out.size) return [...out];
  const key = new Set(tokenize(factStatement).map((t) => t.w).filter((w) => /\d/.test(w) || w.length >= 6));
  for (const s of body.split(/(?<=[.!?।])\s+|\n+/)) {
    const words = tokenize(s).map((t) => t.w);
    if (words.length >= 2 && words.filter((w) => key.has(w)).length >= 2) out.add(s.trim());
  }
  return [...out].slice(0, 4);
}

/** Phrases still present on the page (fuzzy: case, punctuation and small edits are tolerated). */
export function findOnPage(pageText: string, phrases: string[]): string[] {
  return phrases.filter((p) => locateQuote(pageText, p, 0.85) !== null);
}

export async function fetchLivePage(raw: string): Promise<{ http: number; text: string }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "ReadbackRecallBot/1.0 (+https://readback-virid.vercel.app)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url); // every hop is re-checked against private addresses
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { http: res.status, text: "" };
    if (type && !/text\/|html|xml|json/i.test(type)) throw new Error(`The link returns ${type.split(";")[0]}, not a web page`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { http: res.status, text: /html/i.test(type) || /<html|<body/i.test(body) ? htmlToText(body) : body };
  }
  throw new Error("Too many redirects");
}

export async function checkLive(url: string, phrases: string[]): Promise<LiveCheck> {
  try {
    const page = await fetchLivePage(url);
    if (page.http >= 400) return { outcome: "unreachable", url, http: page.http, matched: [], looked_for: phrases, error: `The page answered HTTP ${page.http}` };
    if (!phrases.length) return { outcome: "inconclusive", url, http: page.http, matched: [], looked_for: phrases, error: "No claim wording was recorded for this fact, so there is nothing to look for" };
    const matched = findOnPage(page.text, phrases);
    if (!matched.length && page.text.length < 200)
      return { outcome: "inconclusive", url, http: page.http, matched, looked_for: phrases, error: "The page returned almost no readable text (it may need JavaScript or block automated checks)" };
    return { outcome: matched.length ? "still_live" : "removed", url, http: page.http, matched, looked_for: phrases };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "The page did not answer within 12 seconds" : e.message) : "The page could not be fetched";
    return { outcome: "unreachable", url, http: null, matched: [], looked_for: phrases, error: msg.slice(0, 160) };
  }
}
