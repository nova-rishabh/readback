import Link from "next/link";
import { getSessionUser } from "@/lib/db/queries";
import { RoleEntries, EmailSignIn } from "@/components/shell/RoleEntry";
import { DisclosureFull } from "@/components/shell/Disclosure";
import { BeliefMeter } from "@/components/review/BeliefMeter";
import { roleLabel } from "@/components/format";

export const dynamic = "force-dynamic";

async function currentUser() {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}

function Mark({ n, sev, kind, children }: { n: number; sev: "high" | "medium"; kind: string; children: React.ReactNode }) {
  return (
    <span className={`proof-mark ${kind}`} data-sev={sev} style={{ cursor: "default" }}>
      {children}
      <sup aria-hidden className="ml-0.5 font-sans text-[11px] font-semibold not-italic" style={{ color: sev === "high" ? "var(--color-proof)" : "var(--color-ochre)" }}>
        {n}
      </sup>
    </span>
  );
}

const NOTES = [
  {
    n: 1,
    label: "[AI]",
    meter: 4,
    text: "4 of 6 readers believed a dermatologist recommends this serum. The ledger only holds F-03, “Dermatologist-tested”.",
  },
  {
    n: 2,
    label: "[AI]",
    meter: 5,
    text: "5 of 6 readers believed results are guaranteed within a week. No fact in the ledger backs a 7-day claim.",
  },
  {
    n: 3,
    label: "[RULE]",
    meter: null,
    text: "“zero chemicals” is on Velura’s banned-terms list. Suggested: “92% naturally derived ingredients” (F-12).",
  },
];

export default async function Landing() {
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
      <header className="flex h-16 items-center justify-between border-b border-rule">
        <span className="font-display text-[22px] font-medium tracking-[-0.01em]">Readback</span>
        {user && (
          <Link href="/app" className="text-[14px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            Continue as {user.name} ({roleLabel[user.role].toLowerCase()})
          </Link>
        )}
      </header>

      <main>
        <section className="grid gap-10 py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-20">
          <div>
            <h1 className="font-display text-[40px] leading-[1.08] tracking-[-0.015em] lg:text-[48px]">
              Readback marks up a marketing draft before it ships: brand rules checked to the clause, and six simulated
              readers telling you what they came away believing.
            </h1>
            <p className="mt-6 max-w-[52ch] text-[15.5px] leading-relaxed text-muted">
              Built for the Velura demo brand, an Indian skincare label. Every belief is traced to the words or image
              that caused it and checked against the brand&rsquo;s Fact Ledger before anyone sees it.
            </p>
          </div>

          <figure aria-label="Example: draft #142 marked up by Readback" className="rounded-md border border-rule bg-sheet">
            <figcaption className="flex items-baseline justify-between border-b border-rule px-5 py-3 text-[13px] text-muted">
              <span>
                Velura draft <span className="font-mono text-ink">#142</span>, Instagram, v1
              </span>
              <span>3 of 7 findings shown</span>
            </figcaption>
            <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <p className="font-display text-[26px] leading-[1.6]">
                <Mark n={1} sev="high" kind="mark-wavy">Dermatologist-loved</Mark> Vitamin C serum.{" "}
                <Mark n={2} sev="high" kind="mark-wavy">Visible glow in 7 days</Mark>. 100% natural,{" "}
                <Mark n={3} sev="medium" kind="mark-double">zero chemicals</Mark>. Shop now
              </p>
              <ol className="flex flex-col gap-4 border-t border-rule pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
                {NOTES.map((note) => (
                  <li key={note.n} className="grid grid-cols-[18px_1fr] gap-x-2 text-[13.5px] leading-snug">
                    <span className="font-semibold tabular-nums">{note.n}</span>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted">{note.label}</span>
                        {note.meter !== null && <BeliefMeter k={note.meter} of={6} compact />}
                      </div>
                      {note.text}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </figure>
        </section>

        <section aria-labelledby="enter-h" className="pb-14">
          <h2 id="enter-h" className="font-display text-[24px] leading-tight">
            Open the Velura workspace
          </h2>
          <p className="mt-1 mb-5 text-[14px] text-muted">
            Four seeded accounts, one click each. Each role sees and can do different things, enforced by row-level security.
          </p>
          <RoleEntries />
          <details className="mt-6 max-w-[720px] text-[14px]">
            <summary className="cursor-pointer text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">
              Sign in with an email and password instead
            </summary>
            <div className="mt-4">
              <EmailSignIn />
            </div>
          </details>
        </section>

        <div className="pb-16">
          <DisclosureFull />
        </div>
      </main>
    </div>
  );
}
