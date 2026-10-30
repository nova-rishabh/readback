const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/** Full disclosure block for the landing page. */
export function DisclosureFull() {
  const cols = [
    {
      title: "Stays on the Readback server",
      body: "Rule checks: banned and embargoed terms, missing disclaimers, colour contrast (WCAG 1.4.3), alt text (WCAG 1.1.1), palette drift. Plain code, no model involved.",
    },
    {
      title: `Sent to Google Gemini (${MODEL})`,
      body: "Draft text, after emails, Indian phone numbers, PAN, Aadhaar, card numbers and embargoed product names are replaced with tokens such as ⟦EMAIL_1⟧, and the image as uploaded: text, faces or logos inside an image are not masked, so do not upload images that show personal data. Gemini plays six readers, checks beliefs against your Fact Ledger, and proposes span-level rewrites. Text embeddings use gemini-embedding-001 (768 dims), or a newer Gemini embedding model when its daily limit is reached.",
    },
    {
      title: "Stored in Supabase",
      body: "Drafts, versions, findings, comments, the Fact Ledger, and an insert-only audit log whose rows are chained by SHA-256. Images sit in a private bucket and are shown through short-lived signed links.",
    },
    {
      title: "Fetched from the web",
      body: "Recall checks open the published URL recorded on a post, read its visible text on the server, and keep only whether the stale wording was found (and the matching phrase) in the audit log. Private and local network addresses are never fetched.",
    },
  ];
  return (
    <section aria-labelledby="disclosure-h" className="border-t border-rule pt-8">
      <h2 id="disclosure-h" className="font-display text-[24px] leading-tight">
        What leaves your machine, and where it goes
      </h2>
      <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => (
          <div key={c.title} className="border-l border-rule-strong pl-4">
            <h3 className="text-[14px] font-semibold">{c.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{c.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 max-w-[72ch] text-[13.5px] leading-relaxed text-muted">
        Simulated readers are a model&rsquo;s guess at how people read, not a survey. Readback flags what to look at; a
        person still approves. With no API key, or with READBACK_MOCK_AI=1, readers are deterministic stand-ins and every
        review screen says so.
      </p>
    </section>
  );
}

/** One-line disclosure for the app footer. */
export function DisclosureFooter() {
  return (
    <footer className="mt-16 border-t border-rule px-6 py-5 text-[12.5px] leading-relaxed text-muted lg:px-8">
      Rule checks run on this server. Reader simulation sends draft text (personal data and embargoed names tokenised
      first) and images as uploaded (not masked) to Google Gemini ({MODEL}, rotating to other Gemini models when busy). Simulated readers are estimates, and a person approves
      every post.
    </footer>
  );
}
