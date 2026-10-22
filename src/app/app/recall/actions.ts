"use server";

import { revalidatePath } from "next/cache";
import { setStatus } from "@/lib/db/queries";

export async function recallAction(submissionId: string, factCode: string) {
  await setStatus(submissionId, "recalled", `Recalled after ${factCode} changed.`);
  revalidatePath("/app/recall");
  revalidatePath("/app");
}
