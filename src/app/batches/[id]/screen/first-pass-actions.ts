"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MODELS, MODEL_SETTINGS, ROUTE_TAG, askModel } from "@/lib/ai/openrouter";
import {
  PROMPT_VERSION,
  buildMessages,
  parseReply,
  type CriteriaForPrompt,
  type RecordForPrompt,
} from "@/lib/ai/first-pass";

// Runs the AI first pass for one batch with one model (US-03, ADR-0015). Each reply is checked,
// then stored with its reproducibility set through store_ai_proposal. Proposals are not decisions.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stays well inside the Vercel function time limit. A run that stops early can be run again:
// records that already have a proposal for this model are skipped.
const TIME_BUDGET_MS = 180_000;
// These mean the rest of the run would fail too, so the run stops.
const STOP_STATUSES = /OpenRouter returned (401|402|403|429)|denied|batch_closed|no_criteria/;

function back(batchId: string, message: string): never {
  redirect(`/batches/${batchId}/screen?error=${encodeURIComponent(message)}`);
}

export async function runFirstPass(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const modelId = String(formData.get("model") ?? "");
  if (!UUID.test(batchId)) redirect("/");

  const model = MODELS.find((option) => option.id === modelId);
  if (!model) back(batchId, "Choose a model for the first pass.");

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "Sign-in is not set up. Check .env.local.");

  const { data: batch } = await supabase
    .from("batches")
    .select("id, source_label, status, criteria_version_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) back(batchId, "That batch could not be found.");
  if (batch.source_label !== "public") {
    back(batchId, "The AI first pass is only available for public batches for now.");
  }
  if (batch.status !== "open") back(batchId, "This batch is closed, so no new proposals can be stored.");
  if (!batch.criteria_version_id) back(batchId, "Set the batch's criteria version on the batch summary first.");

  const [{ data: version }, { data: reasons }, { data: records }, { data: existing }] = await Promise.all([
    supabase
      .from("criteria_versions")
      .select("review_topic, population, intervention, comparator, outcomes, design, dates")
      .eq("id", batch.criteria_version_id)
      .single(),
    supabase.from("criteria_reasons").select("code, label").eq("criteria_version_id", batch.criteria_version_id),
    supabase.from("records").select("pmid, title, abstract").eq("batch_id", batchId).order("pmid"),
    supabase
      .from("ai_proposals")
      .select("record_pmid")
      .eq("batch_id", batchId)
      .eq("model_id", model.id)
      .eq("prompt_version", PROMPT_VERSION),
  ]);
  if (!version || !reasons || !records) back(batchId, "Could not load the criteria or records. Try again.");

  const criteria: CriteriaForPrompt = {
    reviewTopic: version.review_topic,
    population: version.population,
    intervention: version.intervention,
    comparator: version.comparator,
    outcomes: version.outcomes,
    design: version.design,
    dates: version.dates,
    reasons: reasons.map((reason) => ({ code: reason.code, label: reason.label })),
  };
  const codes = criteria.reasons.map((reason) => reason.code);
  const done = new Set((existing ?? []).map((row) => row.record_pmid));
  const pending: RecordForPrompt[] = records.filter((record) => !done.has(record.pmid));

  const started = Date.now();
  let proposed = 0;
  let unreadable = 0;
  let failed = 0;
  let stoppedEarly = false;
  let lastError = "";

  for (const record of pending) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      stoppedEarly = true;
      break;
    }
    try {
      const reply = await askModel(model.id, buildMessages(criteria, record));
      const parsed = parseReply(reply.content, codes);

      const { data: result, error } = await supabase.rpc("store_ai_proposal", {
        p_batch_id: batchId,
        p_record_pmid: record.pmid,
        p_model_id: model.id,
        p_prompt_version: PROMPT_VERSION,
        p_settings: MODEL_SETTINGS,
        p_raw_output: reply.content,
        p_status: parsed.status,
        p_outcome: parsed.status === "proposed" ? parsed.outcome : null,
        p_reason_code: parsed.status === "proposed" ? parsed.reasonCode : null,
        p_rationale: parsed.status === "proposed" ? parsed.rationale : null,
        p_upstream_provider: reply.upstreamProvider,
        p_route_tag: ROUTE_TAG,
        p_zdr_enforced: true,
        p_data_region_reported: reply.dataRegionReported,
        p_generation_id: reply.generationId,
      });
      if (error || result !== "ok") {
        failed++;
        lastError = error?.message ?? String(result);
        if (STOP_STATUSES.test(lastError)) break;
        continue;
      }
      if (parsed.status === "proposed") proposed++;
      else unreadable++;
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : "Unknown error";
      if (STOP_STATUSES.test(lastError)) break;
    }
  }

  revalidatePath(`/batches/${batchId}/screen`);

  const parts = [`${model.label}: ${proposed} proposed, ${unreadable} unreadable, ${failed} failed.`];
  if (stoppedEarly) parts.push("Stopped at the time limit. Run it again to finish the rest.");
  if (failed && lastError) parts.push(`Last error: ${lastError}`);
  redirect(`/batches/${batchId}/screen?notice=${encodeURIComponent(parts.join(" "))}`);
}
