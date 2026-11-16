"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { start } from "workflow/api";
import { PROMPT_VERSION } from "@/lib/ai/first-pass";
import { MODELS } from "@/lib/ai/openrouter";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { aiFirstPassWorkflow } from "@/workflows/ai-first-pass";

// Starts the AI first pass for a whole batch in the background (US-03, ADR-0018). The database
// checks who may start it and records the run. The run gets a random key; the database keeps only
// its hash, and the background steps use the key to act for this run alone.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const START_MESSAGES: Record<string, string> = {
  not_found: "That batch could not be found.",
  denied: "Only a reviewer or owner on this batch can run the AI first pass.",
  batch_closed: "This batch is closed, so no new proposals can be stored.",
  confidential_not_allowed: "The AI first pass is only available for public batches for now.",
  no_criteria: "Set the batch's criteria version on the batch summary first.",
  already_running: "A first pass with this model is already running on this batch.",
  nothing_to_do: "Every record already has a proposal from this model.",
};

function back(batchId: string, param: "error" | "notice", message: string): never {
  redirect(`/batches/${batchId}/screen?${param}=${encodeURIComponent(message)}`);
}

export async function runFirstPass(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const modelId = String(formData.get("model") ?? "");
  if (!UUID.test(batchId)) redirect("/");

  const model = MODELS.find((option) => option.id === modelId);
  if (!model) back(batchId, "error", "Choose a model for the first pass.");

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "error", "Sign-in is not set up. Check .env.local.");

  const key = randomBytes(32).toString("base64url");
  const keyHash = createHash("sha256").update(key, "utf8").digest("hex");

  const { data, error } = await supabase.rpc("start_ai_run", {
    p_batch_id: batchId,
    p_model_id: model.id,
    p_prompt_version: PROMPT_VERSION,
    p_key_hash: keyHash,
  });
  const started = (Array.isArray(data) ? data[0] : data) as { result: string; run_id: string | null } | null;
  if (error || !started) {
    if (error) console.error("start_ai_run failed:", error.message);
    back(batchId, "error", "The first pass could not be started. Try again.");
  }
  if (started.result !== "ok" || !started.run_id) {
    back(batchId, "error", START_MESSAGES[started.result] ?? "The first pass could not be started. Try again.");
  }

  try {
    await start(aiFirstPassWorkflow, [started.run_id, key, model.id]);
  } catch (caught) {
    console.error("Starting the workflow failed:", caught instanceof Error ? caught.message : caught);
    // Ends the run so it does not block a new one.
    await supabase.rpc("finish_ai_run", {
      p_run_id: started.run_id,
      p_key: key,
      p_failed: true,
      p_message: "The background run could not be started.",
    });
    back(batchId, "error", "The background run could not be started. Try again.");
  }

  revalidatePath(`/batches/${batchId}/screen`);
  back(batchId, "notice", `${model.label}: the first pass is running in the background. Progress shows below.`);
}
