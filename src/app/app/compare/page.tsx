import { Page, PageHeader } from "@/components/shell/PageHeader";
import { CompareForm } from "@/components/CompareForm";

export const metadata = { title: "Compare versions" };

export default function ComparePage() {
  return (
    <Page>
      <PageHeader
        title="Compare versions"
        lede="Translations rarely change the words that rule checks look for; they change what readers believe. The panel reads the English master and its Hindi or Hinglish version and shows every belief the translation adds or makes stronger."
      />
      <CompareForm />
    </Page>
  );
}
