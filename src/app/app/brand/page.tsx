import { getBrand, getSessionUser } from "@/lib/db/queries";
import { Page, PageHeader } from "@/components/shell/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { ClausesTab } from "@/components/brand/ClausesTab";
import { FactsTab } from "@/components/brand/FactsTab";
import { TermsTab } from "@/components/brand/TermsTab";
import { VoiceTab } from "@/components/brand/VoiceTab";
import { PersonasTab } from "@/components/brand/PersonasTab";

export const metadata = { title: "Brand Space" };

const TABS = ["clauses", "facts", "terms", "voice", "personas"] as const;
type Tab = (typeof TABS)[number];

export default async function BrandPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "clauses";
  const [brand, user] = await Promise.all([getBrand(), getSessionUser()]);
  const canEdit = user?.role === "owner";

  const PURPOSE: Record<Tab, string> = {
    clauses: "The written brand rules that every finding cites.",
    facts: "Claims the brand can prove. Readers' beliefs are checked against these (the Fact Ledger).",
    terms: "Words drafts must avoid or use instead.",
    voice: "The brand's approved colours and how it should sound.",
    personas: "The audience readers the AI panel plays when it reads a draft.",
  };
  const items = [
    { id: "clauses", label: "Guidelines", href: "/app/brand?tab=clauses", count: brand.clauses.length },
    { id: "facts", label: "Approved facts", href: "/app/brand?tab=facts", count: brand.facts.length },
    { id: "terms", label: "Banned and preferred words", href: "/app/brand?tab=terms", count: brand.terms.length },
    { id: "voice", label: "Palette and voice", href: "/app/brand?tab=voice" },
    { id: "personas", label: "Reader personas", href: "/app/brand?tab=personas", count: brand.personas.length },
  ];

  return (
    <Page>
      <PageHeader
        title={`${brand.name} Brand Space`}
        lede={
          canEdit
            ? "The rules every draft is checked against. Changes apply to the next check; facts are versioned so past approvals stay traceable."
            : "The rules every draft is checked against. Only the brand owner can edit them."
        }
      />
      <Tabs label="Brand Space sections" items={items} value={tab} />
      <p className="mt-4 text-[13.5px] text-muted">{PURPOSE[tab]}</p>
      {!canEdit && <p className="mt-1 text-[13.5px] font-medium text-ink">View only. Switch to Brand owner (top right) to edit.</p>}
      <div className="pt-6">
        {tab === "clauses" && <ClausesTab clauses={brand.clauses} canEdit={canEdit} />}
        {tab === "facts" && <FactsTab facts={brand.facts} canEdit={canEdit} />}
        {tab === "terms" && <TermsTab terms={brand.terms} clauses={brand.clauses} canEdit={canEdit} />}
        {tab === "voice" && <VoiceTab traits={brand.voice_traits} palette={brand.palette} canEdit={canEdit} />}
        {tab === "personas" && <PersonasTab personas={brand.personas} canEdit={canEdit} />}
      </div>
    </Page>
  );
}
