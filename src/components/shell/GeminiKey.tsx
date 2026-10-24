"use client";

// Top-bar badge saying whose Gemini key powers the AI readers, and a dialog to use your own.
// The key is checked with Google, then kept only in this browser and sent with this viewer's AI requests.
import { useRef, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { clsx } from "clsx";
import { KEY_HEADER, setGeminiKey, useGeminiKey } from "@/lib/client/gemini-key";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

export function GeminiKeyBadge() {
  const key = useGeminiKey();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });

  const open = () => {
    setDraft("");
    setState({ busy: false, error: null, saved: false });
    dialog.current?.showModal();
  };

  async function save() {
    const k = draft.trim();
    if (!k) return setState((s) => ({ ...s, error: "Paste your key first." }));
    setState({ busy: true, error: null, saved: false });
    try {
      const r = await fetch("/api/gemini-key", { method: "POST", headers: { [KEY_HEADER]: k } });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) return setState({ busy: false, error: j.error ?? "That key didn't work.", saved: false });
      setGeminiKey(k);
      setDraft("");
      setState({ busy: false, error: null, saved: true });
    } catch {
      setState({ busy: false, error: "Couldn't check the key. Try again.", saved: false });
    }
  }

  const own = !!key;
  return (
    <>
      <button
        type="button"
        onClick={open}
        className={clsx(
          "inline-flex h-9 items-center gap-1.5 rounded-[5px] border px-2.5 text-[12.5px]",
          own ? "border-moss/40 bg-moss-tint text-moss" : "border-ochre/40 bg-ochre-tint text-ochre",
        )}
        aria-haspopup="dialog"
        aria-label={own ? "Your Gemini key" : "Free Gemini key"}
        title={own ? "Your Gemini key" : "Free Gemini key"}
      >
        <KeyRound size={13} aria-hidden />
        <span className="hidden md:inline">{own ? "Your Gemini key" : "Free Gemini key"}</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="gk-title"
        className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-md border border-rule-strong bg-sheet p-0 text-ink backdrop:bg-ink/45"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id="gk-title" className="font-display text-[23px] leading-tight">
              {own ? "Using your Gemini key" : "Running on a free Gemini key"}
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {own
                ? "Your checks and translation comparisons use your own key, so they skip the shared free-tier limits. Other visitors still use the shared key."
                : "This demo shares one free Google Gemini key. Free keys allow about 5 requests a minute per model, so a live check takes one to three minutes and can stop early when Google is busy. Rule checks never need a key."}
            </p>
          </div>

          {!own && (
            <ol className="list-decimal space-y-1 pl-5 text-[14px]">
              <li>
                Create a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Google AI Studio
                </a>
                .
              </li>
              <li>Paste it below. We check it with Google before saving.</li>
            </ol>
          )}

          {!own && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="flex flex-col gap-3"
            >
              <Field label="Your Gemini API key" error={state.error} hint="Starts with “AIza”.">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="AIza…"
                  />
                )}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={state.busy}>
                  {state.busy && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                  {state.busy ? "Checking key" : "Check and use key"}
                </Button>
                <Button type="button" onClick={() => dialog.current?.close()}>
                  Not now
                </Button>
              </div>
            </form>
          )}

          {own && (
            <div className="flex flex-wrap items-center gap-2">
              {state.saved && (
                <p role="status" className="mr-auto text-[14px] text-moss">
                  Key checked and saved. Your next check uses it.
                </p>
              )}
              <Button type="button" variant="primary" onClick={() => dialog.current?.close()}>
                Done
              </Button>
              <Button type="button" onClick={() => setGeminiKey(null)}>
                Forget my key
              </Button>
            </div>
          )}

          <p className="border-t border-rule pt-3 text-[12.5px] leading-relaxed text-muted">
            Your key stays in this browser only. It is sent with your own AI requests and passed straight to Google; Readback
            never stores or logs it. Draft text is still masked for personal data before any AI call.
          </p>
        </div>
      </dialog>
    </>
  );
}
