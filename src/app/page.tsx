import Link from "next/link";
import { getSessionUser } from "@/lib/db/queries";
import { RoleEntries, EmailSignIn, EnterAsButton } from "@/components/shell/RoleEntry";
import { DisclosureFull } from "@/components/shell/Disclosure";
import { ProofSheet } from "@/components/landing/ProofSheet";
import { buttonClass } from "@/components/ui/Button";
import { roleLabel } from "@/components/format";

export const dynamic = "force-dynamic";

const REPO = "https://github.com/nova-rishabh/readback";

async function currentUser() {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}

// A draft really does move through these in order, so they are numbered.
const STEPS = [
  { title: "Submit a draft", body: "Paste the copy, add the image, and write one line on what readers should take away." },
  { title: "Rules run instantly", body: "Banned terms, missing disclaimers, embargoed names, image contrast and alt text, checked by plain code." },
  { title: "Six readers react", body: "Simulated readers say what they believe after five seconds with the post, including what it only implies." },
  { title: "Beliefs meet the facts", body: "Each belief is checked against the brand’s approved facts (the Fact Ledger): supported, contradicted, or unsupported." },
  { title: "A person decides", body: "The creator accepts or disputes each finding; a reviewer approves. Every decision is logged." },
];

const RULES = [
  "Banned and preferred terms, matched to the clause",
  "Required disclaimers and embargoed product names",
  "Text-on-image contrast measured from pixels (WCAG 1.4.3)",
  "Alt text (WCAG 1.1.1) and off-palette colours",
];
const READERS = [
  "Implied claims: endorsements, guarantees, “natural”",
  "Tone against the brand’s voice",
  "Beliefs that contradict or lack an approved fact",
  "Translations that make a claim stronger",
];

// what happens around the check: translations, live posts, and how well the engine does against the regulator
const AFTER = [
  {
    title: "Translations can't quietly promise more",
    body: "Link a Hindi, Hinglish, Tamil or Marathi version to its English master. Every check compares what readers believe from both, and anything the translation adds or makes stronger, like पक्का (“guaranteed”), becomes a finding a reviewer must clear.",
  },
  {
    title: "Live posts are re-checked when facts change",
    body: "When an approved fact changes or expires, every post that cited it joins the Recall queue. Readback opens each live page, looks for the stale wording, and closes the recall itself once it is gone. Expiry alerts arrive before a fact lapses.",
  },
  {
    title: "Measured against the regulator",
    body: "ASCI-Bench runs the engine on 100 real Advertising Standards Council of India rulings, three times each, against a single-prompt baseline, with and without the evidence ASCI accepted. Every case and its result is open to inspect.",
  },
];

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#checks", label: "What it checks" },
  { href: "#after", label: "After the check" },
  { href: "#roles", label: "Try a role" },
];

export default async function Landing() {
  const user = await currentUser();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-1.5 focus:text-sheet"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-rule bg-sheet/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-8 px-5 lg:px-10">
          <Link href="/" className="font-display text-[22px] font-medium tracking-[-0.01em]">
            Readback
          </Link>
          <nav aria-label="Page sections" className="hidden items-center gap-6 text-[14px] text-muted md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </a>
            ))}
            <a href={REPO} className="hover:text-ink" target="_blank" rel="noreferrer">
              Source code
            </a>
          </nav>
          <div className="ml-auto">
            {user ? (
              <Link href="/app" className={buttonClass("primary", "md")}>
                Continue as {user.name.split(" ")[0]} ({roleLabel[user.role].toLowerCase()})
              </Link>
            ) : (
              <a href="#roles" className={buttonClass("primary", "md")}>
                Try the demo
              </a>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1180px] px-5 lg:px-10">
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-20">
          <div>
            <h1 className="max-w-[17ch] font-display text-[34px] leading-[1.1] tracking-[-0.015em] sm:text-[42px] lg:text-[46px]">
              Know what readers will believe before your ad goes live.
            </h1>
            <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-muted">
              Readback checks marketing drafts against your brand rules and approved facts, then shows the claims readers take away,
              including the ones the copy only implies. Every finding cites its source and a person makes the final call.
            </p>
            <div className="mt-8 flex flex-wrap items-start gap-3">
              <EnterAsButton role="creator">Try it as a creator</EnterAsButton>
              <a href="#how" className={buttonClass("secondary", "lg")}>
                See how it works
              </a>
            </div>
            <p className="mt-4 text-[13px] text-muted">No sign-up. You&apos;ll land in the Velura workspace with example drafts already checked.</p>
          </div>
          <ProofSheet />
        </section>

        <section id="how" aria-labelledby="how-h" className="scroll-mt-20 border-t border-rule py-14 lg:py-16">
          <h2 id="how-h" className="font-display text-[28px] leading-tight lg:text-[32px]">
            How a draft moves through Readback
          </h2>
          <ol className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2">
                <span className="font-display text-[30px] leading-none text-proof">{i + 1}</span>
                <h3 className="text-[16px] font-semibold">{s.title}</h3>
                <p className="text-[14px] leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="checks" aria-labelledby="checks-h" className="scroll-mt-20 border-t border-rule py-14 lg:py-16">
          <h2 id="checks-h" className="font-display text-[28px] leading-tight lg:text-[32px]">
            Two kinds of check, labelled on every finding
          </h2>
          <p className="mt-3 max-w-[64ch] text-[15.5px] leading-relaxed text-muted">
            Anything that can be decided exactly is checked by code. Only questions of meaning go to the AI, and an AI finding
            has to quote the words or point to the part of the image that caused it.
          </p>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            {[
              { tag: "[RULE]", title: "Rule checks", lede: "Exact, instant, no AI involved.", items: RULES },
              { tag: "[AI]", title: "AI reader panel", lede: "Six simulated readers, grounded in the draft and the approved facts.", items: READERS },
            ].map((col) => (
              <div key={col.title} className="border-l-2 border-ink pl-5">
                <h3 className="flex items-baseline gap-2 text-[18px] font-semibold">
                  {col.title} <span className="font-mono text-[12px] font-normal text-muted">{col.tag}</span>
                </h3>
                <p className="mt-1 text-[14px] text-muted">{col.lede}</p>
                <ul className="mt-4 flex flex-col gap-2.5 text-[15px]">
                  {col.items.map((it) => (
                    <li key={it} className="flex gap-2.5">
                      <span aria-hidden className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-ink" />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="after" aria-labelledby="after-h" className="scroll-mt-20 border-t border-rule py-14 lg:py-16">
          <h2 id="after-h" className="font-display text-[28px] leading-tight lg:text-[32px]">
            Beyond the first check
          </h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {AFTER.map((a) => (
              <div key={a.title} className="flex flex-col gap-2 border-t-2 border-ink pt-4">
                <h3 className="text-[16.5px] font-semibold">{a.title}</h3>
                <p className="text-[14.5px] leading-relaxed text-muted">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="roles" aria-labelledby="enter-h" className="scroll-mt-20 border-t border-rule py-14 lg:py-16">
          <h2 id="enter-h" className="font-display text-[28px] leading-tight lg:text-[32px]">
            Try it from any seat
          </h2>
          <p className="mt-3 mb-7 max-w-[64ch] text-[15.5px] leading-relaxed text-muted">
            Four demo accounts, one click each. A short guided tour starts automatically when you arrive; reopen it any time from the Tour
            button in the top bar.
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

        <section aria-label="Privacy and AI use" className="border-t border-rule py-14">
          <DisclosureFull />
        </section>
      </main>

      <script
        type="application/ld+json"
        // static, server-authored JSON: describes the product for search engines
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Readback",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description: "Pre-publication brand and claim checker: brand rules, approved facts and six simulated readers, with human review.",
            url: "https://readback-virid.vercel.app",
            offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
          }),
        }}
      />
      <footer className="border-t border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-muted lg:px-10">
          <span>Readback, by Team Nova for the Inkloom AI brand-governance challenge.</span>
          <a href={REPO} className="underline decoration-rule-strong underline-offset-4 hover:text-ink" target="_blank" rel="noreferrer">
            Source code on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
