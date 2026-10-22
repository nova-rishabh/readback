"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BrandResult } from "@/app/app/brand/actions";

/** Runs a Brand Space server action, tracks pending/error/saved, refreshes on success. */
export function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function save(fn: () => Promise<BrandResult>, okMessage: string, onOk?: () => void) {
    setError(null);
    setSaved(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(okMessage);
      onOk?.();
      router.refresh();
    });
  }

  return { pending, error, saved, save, setError };
}

export function SaveStatus({ error, saved }: { error: string | null; saved: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-[12.5px] text-proof">
        {error}
      </p>
    );
  if (saved)
    return (
      <p role="status" className="text-[12.5px] text-moss">
        {saved}
      </p>
    );
  return null;
}
