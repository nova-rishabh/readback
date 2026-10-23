import Link from "next/link";
import { getInsights } from "@/lib/db/queries";
import { Page, PageHeader } from "@/components/shell/PageHeader";
import { fmtDate, relDays, roleLabel } from "@/components/format";

export const metadata = { title: "Insights" };

function Section({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-rule bg-sheet p-5" aria-label={title}>
      <div>
        <h2 className="font-display text-[21px] leading-tight">{title}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{lede}</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-[13.5px] text-muted">{children}</p>;
}

export default async function InsightsPage() {
  const ins = await getInsights();
  const maxClause = Math.max(1, ...ins.topClauses.map((c) => c.count));
  const maxAuthor = Math.max(1, ...ins.byAuthor.map((a) => a.findings));

  return (
    <Page>
      <PageHeader
        title="Insights"
        lede="Where drafts keep breaking the rules, and which rules people keep arguing with. Counts cover every saved check."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Rules broken most often" lede="Findings per clause, rule and reader findings together.">
          {ins.topClauses.length === 0 ? (
            <Empty>No findings cite a clause yet. Run a few checks to fill this page.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {ins.topClauses.map((c) => (
                <li key={c.code} className="grid grid-cols-[56px_1fr_36px] items-center gap-3 text-[13.5px]">
                  <span className="font-mono text-[12.5px]">{c.code}</span>
                  <div className="min-w-0">
                    <p className="truncate">{c.title}</p>
                    <div className="mt-1 h-2 rounded-[1px] bg-paper" aria-hidden>
                      <div className="h-2 rounded-[1px] bg-ink" style={{ width: `${(c.count / maxClause) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-right tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Findings by author" lede="Total findings on each author's drafts; the red part is high severity.">
          {ins.byAuthor.length === 0 ? (
            <Empty>No checks have run yet. Run a few checks to fill this page.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {ins.byAuthor.map((a) => (
                <li key={a.name} className="grid grid-cols-[140px_1fr_64px] items-center gap-3 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="block truncate">{a.name}</span>
                    <span className="text-[12px] text-muted">{roleLabel[a.role]}</span>
                  </span>
                  <div
                    className="flex h-2.5 rounded-[1px] bg-paper"
                    role="img"
                    aria-label={`${a.findings} findings, ${a.high} high severity`}
                  >
                    <div className="h-full bg-proof" style={{ width: `${(a.high / maxAuthor) * 100}%` }} />
                    <div className="h-full bg-ink/70" style={{ width: `${((a.findings - a.high) / maxAuthor) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">
                    {a.findings}
                    <span className="ml-1 text-[12px] text-proof">{a.high}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Rules people dispute"
          lede="High dispute rates or readers split down the middle usually mean the clause needs rewording, not the drafts."
        >
          {ins.unclear.length === 0 ? (
            <Empty>No clause is disputed often or splits readers. The rules read clearly so far.</Empty>
          ) : (
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-rule text-left text-[12px] text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Clause</th>
                  <th scope="col" className="w-40 py-1.5 pr-3 font-medium">Disputed</th>
                  <th scope="col" className="w-20 py-1.5 text-right font-medium">Readers split</th>
                </tr>
              </thead>
              <tbody>
                {ins.unclear.map((u) => {
                  const pct = Math.round(u.disputeRate * 100);
                  return (
                    <tr key={u.code} className="border-b border-rule last:border-b-0">
                      <td className="py-2 pr-3">
                        <span className="mr-2 font-mono text-[12.5px]">{u.code}</span>
                        {u.title}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 rounded-[1px] bg-paper" aria-hidden>
                            <div className="h-2 rounded-[1px] bg-ochre" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="tabular-nums">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{u.splitCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Stale facts" lede="Expired or expiring within 30 days. Claims that lean on these will start failing.">
          {ins.staleFacts.length === 0 ? (
            <Empty>Every fact in the ledger is current.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {ins.staleFacts.map((f) => {
                const d = relDays(f.expires_on);
                const expired = f.status === "expired" || (d !== null && d < 0);
                return (
                  <li key={f.id} className="grid grid-cols-[48px_1fr_auto] gap-3 py-2 text-[13.5px]">
                    <span className="font-mono text-[12.5px]">{f.code}</span>
                    <span className="font-display text-[15px] leading-snug">{f.statement}</span>
                    <span className={`text-right text-[12.5px] whitespace-nowrap ${expired ? "text-proof" : "text-ochre"}`}>
                      {expired ? `Expired ${fmtDate(f.expires_on)}` : `${d} day${d === 1 ? "" : "s"} left`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/app/brand?tab=facts" className="self-start text-[13px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            Open the Fact Ledger
          </Link>
        </Section>
      </div>
    </Page>
  );
}
