"use client";

// First-visit guided tour. Each page has a short list of steps anchored to [data-tour="…"] elements; the tour
// spotlights the element and explains it in a small card. Seen tours are remembered per browser (localStorage),
// and the help button in the top bar reopens the tour for the current page.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface Step {
  target: string | null; // data-tour value; null = centred card with no spotlight
  title: string;
  body: string;
}

const TOURS: Record<string, Step[]> = {
  inbox: [
    {
      target: null,
      title: "Welcome to Readback",
      body: "Readback checks marketing drafts before they are published. Code checks the brand rules; six simulated readers report what the post makes them believe; you decide what to change. This tour takes under a minute.",
    },
    { target: "inbox-list", title: "Every draft, with its status", body: "Drafts move from Draft to In review to Approved and Published. Click any row to open its review. Start with #142: its findings are already saved." },
    { target: "nav-new", title: "Check your own copy", body: "Submit a draft here, or import it from a DOCX, PDF or TXT file. The “Fill in the demo draft” button fills the form so you can watch a live check run." },
    { target: "inbox-list", title: "Translations stay true", body: "#146 is the Hindi version of #145. Open an English draft and choose “Add a translation”: every check compares what readers believe from both versions, and a claim the translation makes stronger becomes a finding." },
    { target: "nav-compare", title: "Quick translation check", body: "Paste any English line and its Hindi, Hinglish, Tamil or Marathi version for a one-off comparison, without saving a draft." },
    { target: "nav-brand", title: "The rules it checks against", body: "Brand Space holds the guideline clauses, approved facts, banned terms and reader personas. The brand owner edits them." },
    { target: "nav-recall", title: "When a fact changes", body: "If an approved fact is edited or expires, every post that relied on it shows up in the Recall queue. Readback opens the live page, looks for the stale wording, and closes the recall once it is gone." },
    { target: "nav-bench", title: "How good is it?", body: "ASCI-Bench scores the engine on 100 real Advertising Standards Council of India rulings, against a single-prompt baseline. Every case is open to inspect." },
    { target: "role-switch", title: "Switch seats any time", body: "Try the same draft as a creator, a reviewer, the brand owner or an outside agency. Each role sees and can do different things." },
    { target: "help", title: "Need this again?", body: "Reopen the tour for this page from this button." },
  ],
  review: [
    { target: "draft", title: "The draft, marked up", body: "Underlined phrases are findings. The number links each mark to its explanation; hover a mark to highlight it." },
    { target: "findings", title: "Findings, with their source", body: "[RULE] findings come from plain code; [AI] findings come from the reader panel. Each cites a clause, a fact or a WCAG rule. Accept a fix, edit it, or dispute it with a note." },
    { target: "readers", title: "What the six readers took away", body: "During a live check, each reader’s takeaway appears here. A belief only becomes a finding when at least two readers form it." },
    { target: "decision", title: "A person makes the call", body: "Creators send drafts for review; reviewers approve or request changes. Every decision is written to a tamper-evident audit log." },
  ],
};

const tourFor = (path: string) => (path === "/app" ? "inbox" : path.startsWith("/app/s/") ? "review" : null);
const KEY = (name: string) => `readback-tour-${name}-v2`; // v2: Round 3 steps (translations, live recall, benchmark)
const seen = (name: string) => {
  try {
    return localStorage.getItem(KEY(name)) === "done";
  } catch {
    return true; // storage blocked: don't nag on every page load
  }
};

export function Tour() {
  const path = usePathname();
  const name = tourFor(path);
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // only steps whose anchor exists on this page (and for this role); evaluated in the browser once the tour is open
  const steps = name && i !== null ? TOURS[name].filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`)) : [];
  const step = i !== null ? steps[i] : null;

  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    if (name) {
      try {
        localStorage.setItem(KEY(name), "done");
      } catch {
        /* private mode */
      }
    }
    setI(null);
    // give focus back to where the person was before the tour took it
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, [name]);

  // auto-start once per page type, after the page has painted its anchors
  useEffect(() => {
    if (!name || seen(name)) return;
    const t = setTimeout(() => setI(0), 600);
    return () => clearTimeout(t);
  }, [name]);

  // reopen from the help button
  useEffect(() => {
    const open = () => name && setI(0);
    window.addEventListener("readback:tour", open);
    return () => window.removeEventListener("readback:tour", open);
  }, [name]);

  useLayoutEffect(() => {
    if (!step?.target) return setRect(null);
    const sel = `[data-tour="${step.target}"]`;
    // re-query every time: streamed pages can swap the anchor element after the tour opens
    const update = () => {
      const el = document.querySelector<HTMLElement>(sel);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    const first = document.querySelector<HTMLElement>(sel);
    const r0 = first?.getBoundingClientRect();
    if (first && r0 && (r0.top < 64 || r0.top > window.innerHeight - 120)) first.scrollIntoView({ block: "start", behavior: "smooth" });
    update();
    const t = setInterval(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    if (i === null) return;
    if (!opener.current && document.activeElement instanceof HTMLElement && !card.current?.contains(document.activeElement)) {
      opener.current = document.activeElement;
    }
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // modal dialog: keep Tab inside the card
      if (e.key === "Tab" && card.current) {
        const f = [...card.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        const inside = card.current.contains(document.activeElement);
        const wrapTo = e.shiftKey
          ? (document.activeElement === first || !inside) && last
          : (document.activeElement === last || !inside) && first;
        if (wrapTo) {
          e.preventDefault();
          wrapTo.focus();
        }
      }
      if (e.key === "ArrowRight") setI((n) => (n !== null && n < steps.length - 1 ? n + 1 : n));
      if (e.key === "ArrowLeft") setI((n) => (n ? n - 1 : n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, steps.length, close]);

  if (!step || i === null) return null;
  const last = i === steps.length - 1;

  // place the card below the target, or above it when there is no room, clamped to the viewport
  const W = 340;
  const style: React.CSSProperties = { width: W };
  if (rect) {
    // below the target, else above, else beside it (tall targets such as page columns), clamped to the viewport
    const H = 230, vw = window.innerWidth, vh = window.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - W - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - H - 12);
    const [top, left] =
      rect.bottom + 12 + H < vh ? [rect.bottom + 12, clampX(rect.left)]
      : rect.top - 12 - H > 0 ? [rect.top - 12 - H, clampX(rect.left)]
      : rect.right + 16 + W < vw ? [clampY(rect.top), rect.right + 16]
      : [clampY(rect.top), clampX(rect.left - 16 - W)];
    style.top = top;
    style.left = left;
  } else {
    style.top = "50%";
    style.left = "50%";
    style.transform = "translate(-50%, -50%)";
    style.width = 420;
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-md transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12,
            boxShadow: "0 0 0 2px var(--color-ink), 0 0 0 9999px rgb(27 26 23 / 0.45)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/45" />
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="fixed rounded-md border border-rule-strong bg-sheet p-5 outline-none"
        style={style}
      >
        <p className="text-[12px] tabular-nums text-muted">
          {i + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="mt-1 font-display text-[21px] leading-tight">
          {step.title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={close} className="mr-auto text-[13px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">
            {last ? "Close" : "Skip tour"}
          </button>
          {i > 0 && (
            <Button size="sm" onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "Start exploring" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Top-bar button that reopens the tour for the current page. */
export function TourButton() {
  const path = usePathname();
  if (!tourFor(path)) return null;
  return (
    <button
      type="button"
      data-tour="help"
      onClick={() => window.dispatchEvent(new Event("readback:tour"))}
      className="inline-flex h-9 items-center rounded-[5px] border border-rule-strong bg-sheet px-3 text-[13.5px] text-muted hover:border-ink hover:text-ink"
    >
      Tour
    </button>
  );
}
