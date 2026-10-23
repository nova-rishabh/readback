import { redirect } from "next/navigation";
import { getSessionUser, getBrand } from "@/lib/db/queries";
import { TopBar } from "@/components/shell/TopBar";
import { Tour } from "@/components/shell/Tour";
import { DisclosureFooter } from "@/components/shell/Disclosure";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/");
  const brandName = await getBrand()
    .then((b) => b.name)
    .catch(() => "Velura");
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar user={{ name: user.name, role: user.role }} brandName={brandName} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <DisclosureFooter />
      <Tour />
    </div>
  );
}
