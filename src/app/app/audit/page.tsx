import Link from "next/link";
import { createClient } from "@/lib/db/server";
import { mapAudit } from "@/lib/db/mappers";
import type { AuditEntry } from "@/lib/types";
import { Page, PageHeader, EmptyState, ErrorNote } from "@/components/shell/PageHeader";
import { VerifyChain } from "@/components/VerifyChain";
import { fmtDateTime, roleLabel } from "@/components/format";

export const metadata = { title: "Audit log" };

async function loadAudit(): Promise<{ rows: AuditEntry[]; error: string | null }> {
  try {
    const sb = await createClient();
    const { data, error } = await sb.from("audit_log").select("*").order("id", { ascending: false }).limit(300);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => mapAudit(r)), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "Could not read the audit log." };
  }
}

function detailText(d: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${d.from.replace(/_/g, " ")} to ${d.to.replace(/_/g, " ")}`);
  if (typeof d.note === "string" && d.note) parts.push(`“${d.note}”`);
  if (typeof d.url === "string") parts.push(d.url);
  if (typeof d.code === "string") parts.push(d.code);
  if (!parts.length) {
    const rest = Object.entries(d).filter(([, v]) => v !== null && typeof v !== "object");
    parts.push(...rest.slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`));
  }
  return parts.join(", ");
}

export default async function AuditPage() {
  const { rows, error } = await loadAudit();

  return (
    <Page>
      <PageHeader
        title="Audit log"
        lede="Insert-only. Each row stores the SHA-256 of the previous row's hash plus its own contents, so editing or deleting any entry breaks every hash after it."
        actions={<VerifyChain count={rows.length} />}
      />
      {error ? (
        <ErrorNote title="The audit log could not be read." detail={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No entries yet">Approvals, change requests, fact edits and published URLs are recorded here.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-[13.5px]">
            <caption className="sr-only">Audit entries, newest first</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-[12px] text-muted">
                <th scope="col" className="w-14 py-2 pr-3 font-medium">ID</th>
                <th scope="col" className="w-28 py-2 pr-3 font-medium">When</th>
                <th scope="col" className="w-44 py-2 pr-3 font-medium">Who</th>
                <th scope="col" className="py-2 pr-3 font-medium">What</th>
                <th scope="col" className="w-36 py-2 pr-3 font-medium">Facts cited</th>
                <th scope="col" className="w-48 py-2 font-medium">Hash / previous</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-rule align-top">
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{a.id}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted">{fmtDateTime(a.created_at)}</td>
                  <td className="py-2 pr-3">
                    {a.actor_name}
                    <div className="text-[12px] text-muted">{roleLabel[a.actor_role] ?? a.actor_role}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                    {a.submission_id && (
                      <Link href={`/app/s/${a.submission_id}`} className="ml-2 text-[12.5px] text-muted underline underline-offset-2 hover:text-ink">
                        open draft
                      </Link>
                    )}
                    <div className="text-[12.5px] text-muted">{detailText(a.detail)}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11.5px]">
                    {a.fact_versions && Object.keys(a.fact_versions).length
                      ? Object.entries(a.fact_versions)
                          .map(([k, v]) => `${k} v${v}`)
                          .join(", ")
                      : <span className="text-muted">none</span>}
                  </td>
                  <td className="py-2 font-mono text-[11px] leading-relaxed">
                    <span title={a.hash}>{a.hash.slice(0, 16)}</span>
                    <div className="text-muted" title={a.prev_hash}>
                      {a.prev_hash.slice(0, 16)}
                    </div>
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
