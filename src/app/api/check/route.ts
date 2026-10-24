import { after } from "next/server";
import { getBrand, getSessionUser, getSubmission, saveCheckResult, signedImageUrl } from "@/lib/db/queries";
import { createClient } from "@/lib/db/server";
import { runCheck } from "@/lib/ai/pipeline";
import type { CheckEvent, Finding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // free-tier Gemini can be slow; findings are also checkpointed as they arrive

// One running check per version and at most two per user on this server instance: double clicks, a second tab or a
// reload mid-run would otherwise start parallel runs that overwrite each other and burn the shared Gemini quota.
const running = new Set<string>();
const perUser = new Map<string, number>();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mimeFromPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

async function resolveSubmissionId(versionId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("versions").select("submission_id").eq("id", versionId).maybeSingle();
  return (data as { submission_id?: string } | null)?.submission_id ?? null;
}

/**
 * POST { versionId, submissionId? } -> NDJSON stream of CheckEvent, one per line.
 * The result is persisted with saveCheckResult once the pipeline finishes.
 */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return json(401, { error: "Sign in first." });

  let payload: { versionId?: string; submissionId?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON: { versionId }." });
  }
  const versionId = payload.versionId;
  if (!versionId) return json(400, { error: "versionId is required." });

  const submissionId = payload.submissionId ?? (await resolveSubmissionId(versionId).catch(() => null));
  if (!submissionId) return json(404, { error: "No version with that id is visible to you." });

  const record = await getSubmission(submissionId).catch(() => null);
  const version = record?.versions.find((v) => v.id === versionId);
  if (!record || !version) return json(404, { error: "No version with that id is visible to you." });
  const latest = Math.max(...record.versions.map((v) => v.n));
  if (version.n !== latest) return json(409, { error: `Only the latest version (v${latest}) can be checked.` });
  if (running.has(versionId)) return json(409, { error: "A check is already running on this version. Wait for it to finish." });
  if ((perUser.get(user.id) ?? 0) >= 2) return json(429, { error: "You already have two checks running. Wait for one to finish." });
  running.add(versionId);
  perUser.set(user.id, (perUser.get(user.id) ?? 0) + 1);
  const release = () => {
    running.delete(versionId);
    perUser.set(user.id, Math.max(0, (perUser.get(user.id) ?? 1) - 1));
  };

  let brand: Awaited<ReturnType<typeof getBrand>>;
  try {
    brand = await getBrand();
  } catch {
    release();
    return json(500, { error: "Could not load the brand rules. Try again." });
  }

  let image: { data: Buffer; mime: string } | null = null;
  if (version.image_path) {
    try {
      const url = await signedImageUrl(version.image_path);
      if (url) {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const mime = res.headers.get("content-type")?.split(";")[0] || mimeFromPath(version.image_path);
          image = { data: Buffer.from(await res.arrayBuffer()), mime };
        }
      }
    } catch {
      image = null; // the pipeline still runs on text; the UI shows the image as missing
    }
  }

  // The check runs as its own job, kept alive with after(): on Vercel a closed response would otherwise end the
  // function, and a person who navigates away (or switches role) mid-check would lose the run. The response stream
  // below only relays the job's events to whoever is still watching.
  const encoder = new TextEncoder();
  let relay = null as ((e: CheckEvent | null) => void) | null; // set once the stream starts
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      relay = (e) => {
        try {
          if (e) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
          else controller.close();
        } catch {
          relay = null; // the viewer went away; the job keeps going
        }
      };
    },
    cancel() {
      relay = null;
    },
  });

  // Checkpoint partial results, so even a run that hits the platform time limit leaves its findings saved.
  let rules: (CheckEvent & { type: "rules" }) | null = null;
  let saving = Promise.resolve();
  const checkpoint = (ai: Finding[]) => {
    const findings = [...(rules?.findings ?? []), ...ai];
    saving = saving.then(() => saveCheckResult(versionId, findings, null).catch(() => undefined));
  };
  const emit = (e: CheckEvent) => {
    if (e.type === "rules") {
      rules = e;
      checkpoint([]);
    }
    if (e.type === "findings") checkpoint(e.findings);
    relay?.(e);
  };
  const job = (async () => {
    try {
      const result = await runCheck(
        {
          text: version.body,
          intent: record.submission.intent,
          lang: record.submission.lang,
          channel: record.submission.channel,
          image,
          imageAlt: version.image_alt,
          lockedPhrases: record.submission.locked_phrases ?? [],
          brand,
          options: { cache: false }, // "Run check again" must really re-run (brand rules may have changed)
        },
        emit,
      );
      await saving;
      await saveCheckResult(versionId, result.findings, result.summary);
      emit({ type: "stage", stage: "done", message: `Saved to v${version.n}.` });
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : "The check stopped unexpectedly." });
    } finally {
      release();
      relay?.(null);
    }
  })();
  after(() => job);

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
