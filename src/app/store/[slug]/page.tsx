import { notFound } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { getSessionUser } from "@/lib/db/queries";
import { DEMO_PAGES } from "@/lib/recall/demo-pages";
import { fmtDateTime } from "@/components/format";
import { LivePageEditor } from "./LivePageEditor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: DEMO_PAGES[slug]?.title ?? "Demo store page", robots: { index: false, follow: false } };
}

async function load(slug: string): Promise<{ title: string; body: string; updated_at: string | null; stored: boolean } | null> {
  try {
    const sb = await createClient();
    const { data, error } = await sb.from("live_pages").select("title, body, updated_at").eq("slug", slug).maybeSingle();
    if (!error && data) return { ...data, stored: true };
  } catch {
    /* fall through to the built-in copy */
  }
  const d = DEMO_PAGES[slug];
  return d ? { ...d, updated_at: null, stored: false } : null;
}

/** A public stand-in for a brand's live product page. Readback's recall checks fetch it like any other URL. */
export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, user] = await Promise.all([load(slug), getSessionUser().catch(() => null)]);
  if (!page) notFound();
  const staff = !!user && user.role !== "agency";

  return (
    <div className="min-h-screen bg-[#fbf8f3]">
      <p className="border-b border-rule bg-ink px-6 py-2 text-center text-[12.5px] text-sheet">
        Demo storefront for the fictional brand Velura. It stands in for a live product page so Readback&apos;s recall checks have
        something real to fetch.
      </p>
      <main className="mx-auto max-w-[760px] px-6 py-12">
        <p className="text-[13px] uppercase tracking-[0.12em] text-muted">Velura</p>
        <h1 className="mt-2 font-display text-[34px] leading-tight">{page.title}</h1>
        <article className="mt-6 flex flex-col gap-4 text-[17px] leading-relaxed">
          {page.body.split(/\n{2,}/).map((p, i) => (
            <p key={i} className={i === 0 ? "font-display text-[22px]" : undefined}>{p}</p>
          ))}
        </article>
        {page.updated_at && <p className="mt-8 text-[12.5px] text-muted">Page last updated {fmtDateTime(page.updated_at)} IST.</p>}
        {staff && <LivePageEditor slug={slug} title={page.title} body={page.body} stored={page.stored} />}
      </main>
    </div>
  );
}
