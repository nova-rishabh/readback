import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-20">
      <h1 className="font-display text-[30px]">This draft is not available</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        It may have been removed, or your role cannot see it. Agency accounts only see drafts they submitted.
      </p>
      <ButtonLink href="/app" variant="primary" className="mt-6">
        Back to the inbox
      </ButtonLink>
    </div>
  );
}
