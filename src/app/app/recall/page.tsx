import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getSessionUser, listRecallQueue } from "@/lib/db/queries";
import { Page, PageHeader, EmptyState } from "@/components/shell/PageHeader";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { canReview, channelLabel } from "@/components/format";
import { recallAction } from "./actions";

export const metadata = { title: "Recall queue" };

export default async function RecallPage() {
  const [queue, user] = await Promise.all([listRecallQueue(), getSessionUser()]);
  const reviewer = user ? canReview(user.role) : false;

  return (
    <Page>
      <PageHeader
        title="Recall queue"
        lede="These published or approved posts relied on a fact that has since changed or expired. Review each one and mark it recalled if it should come down."
      />
      {queue.length === 0 ? (
        <EmptyState title="No recalls">
          No recalls. Edit or expire a fact in Brand Space &gt; Approved facts and any post that cited it appears here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <caption className="sr-only">Posts to review for recall</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-[12.5px] text-muted">
                <th scope="col" className="w-16 py-2 pr-3 font-medium">No.</th>
                <th scope="col" className="py-2 pr-3 font-medium">Post</th>
                <th scope="col" className="w-20 py-2 pr-3 font-medium">Fact</th>
                <th scope="col" className="py-2 pr-3 font-medium">Why it is here</th>
                <th scope="col" className="w-40 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={`${q.submission.id}-${q.fact_code}`} className="border-b border-rule align-top">
                  <td className="py-3 pr-3 font-mono text-[12.5px] text-muted">#{q.submission.number}</td>
                  <td className="py-3 pr-3">
                    <Link href={`/app/s/${q.submission.id}`} className="font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                      {q.submission.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <StatusPill status={q.submission.status} />
                      {channelLabel[q.submission.channel]}
                      {q.url && (
                        <a href={q.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">
                          Live post <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12.5px]">{q.fact_code}</td>
                  <td className="py-3 pr-3 text-[13.5px] leading-relaxed">{q.reason}</td>
                  <td className="py-2.5 text-right">
                    {reviewer && q.submission.status !== "recalled" ? (
                      <form action={recallAction.bind(null, q.submission.id, q.fact_code)}>
                        <Button type="submit" size="sm" variant="danger">
                          Mark recalled
                        </Button>
                      </form>
                    ) : q.submission.status === "recalled" ? (
                      <span className="text-[12.5px] text-muted">Recalled</span>
                    ) : (
                      <span className="text-[12.5px] text-muted">Reviewer decides</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
