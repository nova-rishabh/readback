import { notFound } from "next/navigation";
import { getBrand, getSessionUser, getSubmission, signedImageUrl } from "@/lib/db/queries";
import { ReviewScreen } from "@/components/review/ReviewScreen";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getSubmission(id).catch(() => null);
  return { title: rec ? `#${rec.submission.number} ${rec.submission.title}` : "Review" };
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string; run?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [record, user, brand] = await Promise.all([getSubmission(id), getSessionUser(), getBrand()]);
  if (!record || !user) notFound();

  const versions = [...record.versions].sort((a, b) => a.n - b.n);
  if (versions.length === 0) notFound();
  const latest = versions[versions.length - 1];
  const requested = sp.v ? versions.find((v) => String(v.n) === sp.v) : undefined;
  const current = requested ?? latest;
  const previous = versions.find((v) => v.n === current.n - 1) ?? null;

  const imageUrl = current.image_path ? await signedImageUrl(current.image_path).catch(() => null) : null;

  const neverChecked = !current.summary && current.findings.length === 0;
  const autoRun = current.id === latest.id && (sp.run === "1" || neverChecked);

  return (
    <ReviewScreen
      key={current.id}
      submission={record.submission}
      versions={versions.map((v) => ({ id: v.id, n: v.n, created_at: v.created_at }))}
      current={current}
      previous={previous}
      isLatest={current.id === latest.id}
      comments={record.comments}
      audit={record.audit}
      user={user}
      personas={brand.personas}
      clauses={brand.clauses}
      facts={brand.facts}
      imageUrl={imageUrl}
      autoRun={autoRun}
    />
  );
}
