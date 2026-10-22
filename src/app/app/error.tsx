"use client";

import { Button } from "@/components/ui/Button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-16">
      <h1 className="font-display text-[28px]">This page could not load</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        Readback could not read from the database. Check that Supabase is reachable and that the env values in
        .env.local are set, then try again.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-md border border-rule bg-sheet p-3 font-mono text-[12px] text-ink/80">
        {error.message}
        {error.digest ? `\ndigest ${error.digest}` : ""}
      </pre>
      <Button className="mt-5" variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
