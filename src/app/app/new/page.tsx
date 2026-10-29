import Link from "next/link";
import { Page, PageHeader } from "@/components/shell/PageHeader";
import { NewDraftForm } from "@/components/NewDraftForm";
import { getMaster, translationsEnabled } from "@/lib/db/queries";

export const metadata = { title: "New draft" };

export default async function NewDraft({ searchParams }: { searchParams: Promise<{ master?: string }> }) {
  const { master: masterId } = await searchParams;
  const master = masterId && /^[0-9a-f-]{36}$/i.test(masterId) ? await getMaster(masterId).catch(() => null) : null;

  if (master && !(await translationsEnabled())) {
    return (
      <Page>
        <PageHeader
          title="Add a translation"
          lede="Linked translations need the Round 3 database update. Ask the workspace admin to run supabase/migrations/0003_round3.sql in the Supabase SQL editor. Until then, Compare translations checks a translation without saving it."
        />
        <Link href="/app/compare" className="text-[14px] underline underline-offset-4">Open Compare translations</Link>
      </Page>
    );
  }

  if (masterId && !master) {
    return (
      <Page>
        <PageHeader title="Add a translation" lede="That English master draft was not found, or you cannot see it." />
        <Link href="/app" className="text-[14px] underline underline-offset-4">Back to the inbox</Link>
      </Page>
    );
  }

  return (
    <Page>
      {master ? (
        <PageHeader
          title="Add a translation"
          lede={`Write the ${"Hindi, Hinglish, Tamil or Marathi"} version of #${master.number}. Every check compares what readers believe from it with the English master, and anything the translation adds or makes stronger becomes a finding.`}
        />
      ) : (
        <PageHeader
          title="Submit a draft"
          lede="Paste the copy exactly as it will run, add the image, and say what a reader should take away. Saving runs the rule check and the six-reader panel straight away."
        />
      )}
      <NewDraftForm
        master={master ? { id: master.id, number: master.number, title: master.title, body: master.body, version: master.version, channel: master.channel, intent: master.intent, lang: master.lang } : null}
      />
    </Page>
  );
}
