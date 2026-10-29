import { NextResponse } from "next/server";
import { getBrand, getSessionUser } from "@/lib/db/queries";
import type { Clause, ClauseKind } from "@/lib/types";
import { extractText as extract } from "@/lib/docs/extract";

export const runtime = "nodejs";

const MAX = 15 * 1024 * 1024;

const RULE_CUES = /\b(must (include|carry|appear)|never use|do not use|banned|prohibited|contrast|alt text|disclaimer|hex|colour|color|font size|logo)\b/i;
const NUMBERED = /^\s*(?:§\s*)?(?:clause\s+)?(\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/i;

function titleOf(s: string) {
  const first = s.split(/(?<=[.:;])\s/)[0].replace(/[.:;]$/, "").trim();
  return first.length > 72 ? first.slice(0, 69).trimEnd() + "..." : first;
}

/** Split raw guideline text into clause candidates: numbered headings first, paragraphs as a fallback. */
function split(text: string): { title: string; body: string }[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const numbered = lines.filter((l) => NUMBERED.test(l)).length;
  const out: { title: string; body: string }[] = [];
  if (numbered >= 2) {
    let cur: { head: string; rest: string[] } | null = null;
    for (const l of lines) {
      const m = l.match(NUMBERED);
      if (m) {
        if (cur) out.push({ title: titleOf(cur.head), body: [cur.head, ...cur.rest].join(" ").trim() });
        cur = { head: m[2], rest: [] };
      } else if (cur && l) cur.rest.push(l);
    }
    if (cur) out.push({ title: titleOf(cur.head), body: [cur.head, ...cur.rest].join(" ").trim() });
  } else {
    for (const para of text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const body = para.replace(/\s+/g, " ").trim();
      if (body.length >= 20) out.push({ title: titleOf(body), body });
    }
  }
  return out.filter((c) => c.body.length >= 12).slice(0, 80);
}

export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Only the brand owner can import guidelines." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || file.size === 0) return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "Guideline files must be 15 MB or smaller." }, { status: 400 });

  let text: string;
  try {
    text = await extract(file);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The file could not be read." }, { status: 422 });
  }
  const parts = split(text);
  if (!parts.length) {
    return NextResponse.json(
      { error: "No clauses found. The file may be a scanned image; export it as text-based PDF or DOCX." },
      { status: 422 },
    );
  }

  const brand = await getBrand();
  let next =
    brand.clauses.reduce((m, c) => {
      const n = Number(c.code.match(/(\d+)$/)?.[1] ?? 0);
      return Math.max(m, n);
    }, 0) + 1;

  const clauses: Omit<Clause, "id">[] = parts.map((p) => ({
    code: `G-${String(next++).padStart(2, "0")}`,
    title: p.title,
    body: p.body,
    kind: (RULE_CUES.test(p.body) ? "rule" : "ai") as ClauseKind,
    confirmed: false,
  }));

  return NextResponse.json({ clauses, chars: text.length, file: file.name });
}
