import Link from "next/link";
import { listSubmissions, getSessionUser } from "@/lib/db/queries";
import type { SubmissionStatus } from "@/lib/types";
import { Page, PageHeader, EmptyState } from "@/components/shell/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Badge, StatusPill, statusLabel } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { STATUSES, channelLabel, langLabel, fmtDateTime, roleLabel } from "@/components/format";

export const metadata = { title: "Inbox" };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as SubmissionStatus) ? (sp.status as SubmissionStatus) : undefined;
  const [all, user] = await Promise.all([listSubmissions(), getSessionUser()]);
  const rows = status ? all.filter((s) => s.status === status) : all;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((x) => x.status === s).length]));

  const tabs = [
    { id: "all", label: "All", href: "/app", count: all.length },
    ...STATUSES.map((s) => ({ id: s, label: statusLabel[s], href: `/app?status=${s}`, count: counts[s] })),
  ];

  return (
    <Page>
      <PageHeader
        title="Inbox"
        lede={
          user?.role === "agency"
            ? "Drafts your agency has submitted to Velura. Other teams' work is not visible to you."
            : "Every draft submitted to Velura, newest first. Open one to see its findings and reader panel."
        }
        actions={
          <ButtonLink href="/app/new" variant="primary">
            Submit a draft
          </ButtonLink>
        }
      />
      <Tabs label="Filter by status" items={tabs} value={status ?? "all"} />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={status ? `No drafts are ${statusLabel[status].toLowerCase()} yet` : "No drafts yet"}
            action={
              !status && (
                <ButtonLink href="/app/new" variant="primary">
                  Submit the first draft
                </ButtonLink>
              )
            }
          >
            {status
              ? "Open a draft that is In review to act on it, and it moves here."
              : "Submit a caption, listing or email with its image. Readback runs the rule check and the reader panel as soon as it is saved."}
          </EmptyState>
        </div>
      ) : (
        <div data-tour="inbox-list" className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <caption className="sr-only">Submissions{status ? `, filtered to ${statusLabel[status]}` : ""}</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-[12.5px] text-muted">
                <th scope="col" className="w-16 py-2 pr-3 font-medium">No.</th>
                <th scope="col" className="py-2 pr-3 font-medium">Title</th>
                <th scope="col" className="py-2 pr-3 font-medium">Channel</th>
                <th scope="col" className="py-2 pr-3 font-medium">Author</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="group relative cursor-pointer border-b border-rule hover:bg-sheet">
                  <td className="py-2.5 pr-3 font-mono text-[12.5px] text-muted">#{s.number}</td>
                  <td className="py-2.5 pr-3">
                    {/* stretched link: the whole row opens the review, while keyboard users still tab to one link */}
                    <Link
                      href={`/app/s/${s.id}`}
                      className="font-medium underline decoration-transparent underline-offset-4 group-hover:decoration-rule-strong after:absolute after:inset-0 after:content-['']"
                    >
                      {s.title}
                    </Link>
                    {s.number === 142 && (
                      <Badge tone="steel" className="relative ml-2 align-middle">
                        Start here
                      </Badge>
                    )}
                    <div className="mt-0.5 line-clamp-1 max-w-[52ch] text-[12.5px] text-muted">Intended: {s.intent}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-muted">
                    {channelLabel[s.channel]}
                    <span className="ml-1.5 text-[12px]">{langLabel[s.lang]}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {s.author_name}
                    <div className="text-[12px] text-muted">{roleLabel[s.author_role]}</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="py-2.5 text-right text-[13px] tabular-nums text-muted">{fmtDateTime(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
