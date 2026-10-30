"use client";

import { keyHeaders } from "@/lib/client/gemini-key";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CheckEvent, CheckSummary, Finding, ReaderResult } from "@/lib/types";

export type StageId = "mask" | "rules" | "readers" | "group" | "verify" | "drift" | "fix" | "done";
export const STAGES: { id: StageId; label: string }[] = [
  { id: "mask", label: "Mask personal data" },
  { id: "rules", label: "Rule engine" },
  { id: "readers", label: "Six readers" },
  { id: "group", label: "Group beliefs" },
  { id: "verify", label: "Check Fact Ledger" },
  { id: "drift", label: "Compare with master" }, // translations only
  { id: "fix", label: "Test fixes" },
  { id: "done", label: "Saved" },
];

export interface StreamState {
  status: "idle" | "running" | "done" | "error";
  stage: StageId | null;
  reached: StageId[];
  message: string | null;
  ruleFindings: Finding[] | null;
  aiFindings: Finding[] | null;
  readers: ReaderResult[];
  summary: CheckSummary | null;
  ruleMs: number | null;
  error: string | null;
  startedAt: number | null;
}

const initial: StreamState = {
  status: "idle",
  stage: null,
  reached: [],
  message: null,
  ruleFindings: null,
  aiFindings: null,
  readers: [],
  summary: null,
  ruleMs: null,
  error: null,
  startedAt: null,
};

type Action = { type: "start" } | { type: "event"; e: CheckEvent } | { type: "fail"; message: string } | { type: "end" } | { type: "busy" };

function reach(s: StreamState, stage: StageId): StreamState {
  const idx = STAGES.findIndex((x) => x.id === stage);
  const reached = STAGES.slice(0, idx + 1).map((x) => x.id);
  const cur = s.stage ? STAGES.findIndex((x) => x.id === s.stage) : -1;
  return idx >= cur ? { ...s, stage, reached } : s;
}

function patchSuggestion(list: Finding[] | null, id: string, sug: Finding["suggestion"]) {
  return list ? list.map((f) => (f.id === id ? { ...f, suggestion: sug } : f)) : list;
}

function reducer(s: StreamState, a: Action): StreamState {
  switch (a.type) {
    case "start":
      return { ...initial, status: "running", stage: "mask", reached: ["mask"], startedAt: Date.now() };
    case "fail":
      return { ...s, status: "error", error: a.message };
    case "busy":
      return { ...initial, message: "A check is already running on this version; its results appear here when it finishes." };
    case "end":
      return s.status === "running" ? { ...s, status: s.error ? "error" : "done" } : s;
    case "event": {
      const e = a.e;
      switch (e.type) {
        case "stage":
          return { ...reach(s, e.stage), message: e.message };
        case "rules":
          return { ...reach(s, "readers"), ruleFindings: e.findings, ruleMs: e.ms };
        case "reader": {
          const others = s.readers.filter((r) => r.persona_id !== e.result.persona_id);
          return { ...reach(s, "readers"), readers: [...others, e.result] };
        }
        case "findings":
          return { ...reach(s, "fix"), aiFindings: e.findings };
        case "suggestion":
          return {
            ...s,
            ruleFindings: patchSuggestion(s.ruleFindings, e.finding_id, e.suggestion),
            aiFindings: patchSuggestion(s.aiFindings, e.finding_id, e.suggestion),
          };
        case "summary":
          return { ...reach(s, "done"), summary: e.summary };
        case "error":
          return { ...s, status: "error", error: e.message };
      }
    }
  }
  return s;
}

/** POSTs to /api/check and folds the NDJSON event stream into state. */
export function useCheckStream(versionId: string, submissionId: string, onFinish?: () => void) {
  const [state, dispatch] = useReducer(reducer, initial);
  const ctrl = useRef<AbortController | null>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async () => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    dispatch({ type: "start" });
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ versionId, submissionId }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 409 && /already running/i.test(j?.error ?? "")) {
          // another tab or click already started this check: keep showing the saved results and refresh when it lands
          dispatch({ type: "busy" });
          finishRef.current?.();
          return;
        }
        dispatch({ type: "fail", message: j?.error ?? `The check endpoint answered ${res.status}.` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handle = (line: string) => {
        const t = line.trim();
        if (!t) return;
        try {
          dispatch({ type: "event", e: JSON.parse(t) as CheckEvent });
        } catch {
          /* ignore a malformed line rather than abort the whole run */
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      buf += decoder.decode();
      handle(buf);
      dispatch({ type: "end" });
      finishRef.current?.();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      dispatch({ type: "fail", message: "The connection dropped before the check finished. Run it again." });
    }
  }, [versionId, submissionId]);

  return { state, run };
}
