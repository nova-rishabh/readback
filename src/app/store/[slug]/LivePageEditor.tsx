"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { saveLivePageAction } from "./actions";

/** Lets a signed-in Velura user play the agency: change the live page, then watch the recall check notice. */
export function LivePageEditor({ slug, title, body, stored }: { slug: string; title: string; body: string; stored: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(body);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="edit-h" className="mt-12 rounded-md border border-rule-strong bg-sheet p-5">
      <h2 id="edit-h" className="font-display text-[19px]">Edit this demo page</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        You are signed in to Readback, so you can play the agency that maintains this listing. Remove the stale claim, save,
        then press <span className="text-ink">Check live page now</span> in the Recall queue: the recall closes itself.
      </p>
      {!stored ? (
        <p className="mt-3 text-[13px] text-ochre">Editing needs the Round 3 database update (supabase/migrations/0003_round3.sql).</p>
      ) : !open ? (
        <Button className="mt-3" size="sm" onClick={() => setOpen(true)}>Edit “{title}”</Button>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const r = await saveLivePageAction(slug, text);
              if (!r.ok) return setMsg(r.error);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <label htmlFor="page-body" className="text-[12.5px] text-muted">Page text. Leave a blank line between paragraphs.</label>
          <Textarea id="page-body" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending || !text.trim()}>{pending ? "Saving" : "Save page"}</Button>
            <Button size="sm" variant="ghost" onClick={() => (setOpen(false), setText(body))}>Cancel</Button>
          </div>
          {msg && <p role="alert" className="text-[12.5px] text-proof">{msg}</p>}
        </form>
      )}
    </section>
  );
}
