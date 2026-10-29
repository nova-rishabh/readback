import Link from "next/link";
import { BellRing, ExternalLink } from "lucide-react";
import { getRecallState, getSessionUser } from "@/lib/db/queries";
import type { RecallItem } from "@/lib/recall/queue";
import type { LiveOutcome } from "@/lib/recall/live";
import { Page, PageHeader, EmptyState, ErrorNote } from "@/components/shell/PageHeader";
import { Badge, StatusPill, type Tone } from "@/components/ui/Badge";
import { RecallControls } from "@/components/RecallControls";
import { canReview, channelLabel, fmtDate, fmtDateTime } from "@/components/format";

export const metadata = { title: "Recall queue" };
export const dynamic = "force-dynamic";

const OUTCOME: Record<LiveOutcome, { label: string; tone: Tone }> = {
  still_live: { label: "Claim still live", tone: "proof" },
  removed: { label: "Claim removed", tone: "moss" },
  unreachable: { label: "Page unreachable", tone: "ochre" },
  inconclusive: { label: "Could not confirm", tone: "ochre" },
};

function LiveStatus({ item }: { item: RecallItem }) {
  if (!item.url)
    return (
      <p className="text-[12.5px] text-muted">
        No live URL recorded. <Link href={`/app/s/${item.submission.id}`} className="underline underline-offset-2">Record it on the post</Link> so
        the page can be checked.
      </p>
    );
  const c = item.last_check;
  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 break-all underline underline-offset-2 hover:text-ink">
        {item.url.replace(/^https?:\/\//, "").slice(0, 60)} <ExternalLink size={12} aria-hidden />
      </a>
      {c ? (
        <>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Badge>
            <span className="text-muted">{fmtDateTime(c.at)} by {c.by}</span>
          </span>
          {c.matched.length > 0 && <span className="font-display text-[14px] italic">“{c.matched[0]}”</span>}
          {c.error && <span className="text-muted">{c.error}</span>}
        </>
      ) : (
        <span className="text-muted">Not checked yet.</span>
      )}
      {item.phrases.length > 0 && !c?.matched.length && (
        <span className="text-muted">
          Looks for: <span className="italic">“{item.phrases.slice(0, 2).join("”, “")}”</span>
        </span>
      )}
    </div>
  );
}

export default async function RecallPage() {
  const user = await getSessionUser();
  const reviewer = user ? canReview(user.role) : false;
  let state: Awaited<ReturnType<typeof getRecallState>> | null = null;
  let error: string | null = null;
  try {
    state = await getRecallState();
  } catch (e) {
    error = e instanceof Error ? e.message : "The recall queue could not be loaded.";
  }

  return (
    <Page>
      <PageHeader
        title="Recall queue"
        lede="Approved or published posts that relied on a fact which has since changed or expired. Readback opens each post's live page and looks for the stale wording: every day at 09:00 IST, whenever a fact is edited, and when you press Check live page now. When the wording is gone, the recall closes itself and the audit log records it."
      />
      {error && <ErrorNote title="The recall queue could not be loaded." detail={error} />}

      {state && state.expiring.length > 0 && (
        <section aria-labelledby="expiring-h" className="mb-8 rounded-md border border-ochre/40 bg-ochre-tint/40 px-5 py-4">
          <h2 id="expiring-h" className="flex items-center gap-2 font-display text-[19px]">
            <BellRing size={17} aria-hidden /> Facts expiring in the next 30 days
          </h2>
          <ul className="mt-2 flex flex-col gap-2 text-[13.5px]">
            {state.expiring.map((a) => (
              <li key={a.fact.code} className="flex flex-col gap-0.5">
                <span>
                  <span className="font-mono text-[12.5px]">{a.fact.code}</span>{" "}
                  <span className="font-medium">{a.days === 0 ? "expires today" : `expires in ${a.days} day${a.days === 1 ? "" : "s"}`}</span>{" "}
                  ({fmtDate(a.fact.expires_on)}): {a.fact.statement}
                </span>
                <span className="text-[12.5px] text-muted">
                  {a.posts.length
                    ? <>Cited by {a.posts.map((p, i) => (
                        <span key={p.id}>{i > 0 && ", "}<Link href={`/app/s/${p.id}`} className="underline underline-offset-2">#{p.number}</Link></span>
                      ))}. Renew the evidence in Brand Space, or these posts join the queue on expiry.</>
                    : "No approved or published post cites it yet."}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state && (state.open.length === 0 ? (
        <EmptyState title="No open recalls">
          Nothing needs recalling. Edit or expire a fact in Brand Space &gt; Approved facts, and every approved or published post
          that cited it appears here.
        </EmptyState>
      ) : (
        <ul aria-label="Posts to review for recall" className="flex flex-col divide-y divide-rule border-y border-rule">
          {state.open.map((q) => (
            <li
              key={`${q.submission.id}-${q.fact_code}`}
              className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-5"
            >
              <div className="min-w-0">
                <span className="font-mono text-[12.5px] text-muted">#{q.submission.number} </span>
                <Link href={`/app/s/${q.submission.id}`} className="font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                  {q.submission.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <StatusPill status={q.submission.status} />
                  {channelLabel[q.submission.channel]}
                </div>
              </div>
              <div className="text-[13px] leading-relaxed">
                <span className="block text-[12px] text-muted md:hidden">Why it is here</span>
                {q.reason}
              </div>
              <div>
                <span className="block text-[12px] text-muted md:hidden">Live page</span>
                <LiveStatus item={q} />
              </div>
              <RecallControls submissionId={q.submission.id} factCode={q.fact_code} hasUrl={!!q.url} reviewer={reviewer} />
            </li>
          ))}
        </ul>
      ))}

      {state && state.closed.length > 0 && (
        <section aria-labelledby="closed-h" className="mt-10">
          <h2 id="closed-h" className="font-display text-[20px]">Closed recalls</h2>
          <p className="mt-1 text-[13.5px] text-muted">Closed for the current version of the fact. If the fact changes again, the post comes back.</p>
          <ul className="mt-3 flex flex-col divide-y divide-rule rounded-md border border-rule bg-sheet text-[13.5px]">
            {state.closed.map((q) => (
              <li key={`${q.submission.id}-${q.fact_code}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="font-mono text-[12px] text-muted">#{q.submission.number}</span>
                <Link href={`/app/s/${q.submission.id}`} className="font-medium underline decoration-rule-strong underline-offset-4">{q.submission.title}</Link>
                <span className="font-mono text-[12px]">{q.fact_code}</span>
                <Badge tone="moss">{q.closed!.auto ? "Closed: claim gone from live page" : "Closed by reviewer"}</Badge>
                <span className="text-[12.5px] text-muted">
                  {fmtDateTime(q.closed!.at)} by {q.closed!.by}
                  {q.closed!.note && !q.closed!.auto && `: “${q.closed!.note}”`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
