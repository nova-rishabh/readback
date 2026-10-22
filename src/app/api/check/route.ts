import { getBrand, getSessionUser, getSubmission, saveCheckResult, signedImageUrl } from "@/lib/db/queries";
import { createClient } from "@/lib/db/server";
import { runCheck } from "@/lib/ai/pipeline";
import type { CheckEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const brand = await getBrand();

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: CheckEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true; // client went away; keep running so the result is still saved
        }
      };
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
          },
          emit,
        );
        await saveCheckResult(versionId, result.findings, result.summary);
        emit({ type: "stage", stage: "done", message: `Saved to v${version.n}.` });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "The check stopped unexpectedly." });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
