import { createClient } from "@supabase/supabase-js";
import { FatalError, RetryableError } from "workflow";
import { buildMessages, parseReply, type CriteriaForPrompt, type RecordForPrompt } from "@/lib/ai/first-pass";
import { MODEL_SETTINGS, ROUTE_TAG, askModel } from "@/lib/ai/model-call";
import { supabaseConfig } from "@/lib/supabase/config";

// The AI first pass for a whole batch, run in the background as a Vercel Workflow (US-03, P-1,
// ADR-0018). Each record is one step, run ten at a time. Steps have no sign-in: they act through
// the run's key, which works only for this run, while it is running, until it expires.
//
// Only ids, the run key and short status words pass between steps, because Vercel stores step
// inputs and outputs. Titles, abstracts and model replies go straight between the database and the
// model inside a step, and are never step inputs or outputs.

const AT_A_TIME = 10;

// Results that mean the rest of the run would fail too, so the run stops.
const STOP_RESULTS = new Set([
  "invalid_key",
  "denied",
  "batch_closed",
  "confidential_not_allowed",
  "no_criteria",
  "provider_refused",
  "wrong_route",
]);

const STOP_MESSAGES: Record<string, string> = {
  invalid_key: "The run ended or expired.",
  denied: "The person who started the run is no longer a reviewer or owner on this batch.",
  batch_closed: "The batch was closed.",
  confidential_not_allowed: "The batch is confidential.",
  no_criteria: "The batch has no criteria version.",
  provider_refused: "OpenRouter refused the request (check the key and credit).",
  wrong_route: "A reply came from a route other than the pinned one.",
};

export async function aiFirstPassWorkflow(runId: string, key: string, modelId: string) {
  "use workflow";

  const pmids = await listPendingRecords(runId, key);

  for (let i = 0; i < pmids.length; i += AT_A_TIME) {
    const chunk = pmids.slice(i, i + AT_A_TIME);
    const results = await Promise.allSettled(chunk.map((pmid) => proposeForRecord(runId, key, modelId, pmid)));

    let stop: string | null = null;
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "rejected") {
        await recordFailure(runId, key, `PMID ${chunk[j]}: ${errorText(result.reason)}`);
      } else if (STOP_RESULTS.has(result.value)) {
        stop = result.value;
      }
    }
    if (stop) {
      await finishRun(runId, key, true, STOP_MESSAGES[stop] ?? stop);
      return { stopped: stop };
    }
  }

  await finishRun(runId, key, false, null);
  return { stopped: null };
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// A Supabase client with no sign-in. It can only call the run-key functions (ADR-0018).
function runClient() {
  const config = supabaseConfig();
  if (!config) throw new FatalError("The Supabase settings are missing.");
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listPendingRecords(runId: string, key: string): Promise<string[]> {
  "use step";
  const { data, error } = await runClient().rpc("ai_run_pending_records", { p_run_id: runId, p_key: key });
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

// Asks the model about one record and stores the proposal. Returns the store result, or a stop
// word. Throws on a passing problem, so the step is retried.
async function proposeForRecord(runId: string, key: string, modelId: string, pmid: string): Promise<string> {
  "use step";
  const supabase = runClient();

  const { data: item, error } = await supabase.rpc("ai_run_work_item", { p_run_id: runId, p_key: key, p_pmid: pmid });
  if (error) throw new Error(error.message);
  if (!item) return "invalid_key";
  const { criteria, record } = item as { criteria: CriteriaForPrompt; record: RecordForPrompt };

  let reply;
  try {
    reply = await askModel(modelId, buildMessages(criteria, record));
  } catch (caught) {
    const message = errorText(caught);
    if (/OpenRouter returned (401|402|403)/.test(message)) return "provider_refused";
    if (/OpenRouter returned 429/.test(message)) throw new RetryableError(message, { retryAfter: "1m" });
    if (/not the pinned route/.test(message)) return "wrong_route";
    throw caught;
  }

  const parsed = parseReply(
    reply.content,
    criteria.reasons.map((reason) => reason.code),
  );
  const { data: result, error: storeError } = await supabase.rpc("store_ai_run_proposal", {
    p_run_id: runId,
    p_key: key,
    p_record_pmid: pmid,
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
  // A failed check in the database will fail the same way again, so it is not retried.
  if (storeError) throw new FatalError(storeError.message);
  return String(result);
}
proposeForRecord.maxRetries = 2;

async function recordFailure(runId: string, key: string, message: string): Promise<void> {
  "use step";
  const { error } = await runClient().rpc("record_ai_run_failure", { p_run_id: runId, p_key: key, p_message: message });
  if (error) throw new Error(error.message);
}

async function finishRun(runId: string, key: string, failed: boolean, message: string | null): Promise<void> {
  "use step";
  const { error } = await runClient().rpc("finish_ai_run", {
    p_run_id: runId,
    p_key: key,
    p_failed: failed,
    p_message: message,
  });
  if (error) throw new Error(error.message);
}
