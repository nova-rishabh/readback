import { Page, PageHeader } from "@/components/shell/PageHeader";
import { NewDraftForm } from "@/components/NewDraftForm";

export const metadata = { title: "New draft" };

export default function NewDraft() {
  return (
    <Page>
      <PageHeader
        title="Submit a draft"
        lede="Paste the copy exactly as it will run, add the image, and say what a reader should take away. Saving runs the rule check and the six-reader panel straight away."
      />
      <NewDraftForm />
    </Page>
  );
}
