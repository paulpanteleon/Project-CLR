"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Screening actions for one batch (US-02, US-04, US-05, US-11, ADR-0014). The app checks the
// shape of the input. The database functions decide who may do what, and which version and
// reason a decision uses.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PMID = /^\d+$/;
const OUTCOMES = ["include", "exclude", "unsure", "send_to_clinician"];

const MESSAGES: Record<string, string> = {
  not_found: "That batch could not be found.",
  denied: "Only a reviewer or owner on this batch can do that.",
  batch_closed: "This batch is closed, so it cannot change.",
  has_decisions: "Decisions already exist in this batch, so its criteria version cannot change.",
  not_approved: "Only an approved criteria version can be used for a batch.",
  no_criteria: "Set the batch's criteria version on the batch summary first.",
  not_in_batch: "That record is not in this batch.",
  superseded: "This decision was already corrected. Reload the page and try again.",
  error: "The change could not be saved. Try again.",
};

// Sends the user back to a page of the batch with a message. redirect() ends the request.
function back(batchId: string, page: "summary" | "screen", message: string): never {
  redirect(`/batches/${batchId}/${page}?error=${encodeURIComponent(message)}`);
}

// Turns a database error into a message. Messages the database raised on purpose are shown as they are.
function messageForError(message: string): string {
  if (message.includes("decision_reason_from_version")) {
    return "That reason is not in this batch's criteria version.";
  }
  if (message.includes("Choose") || message.includes("needs a reason") || message.includes("supporting text")) {
    return message;
  }
  return MESSAGES.error;
}

// Sets the criteria version for a batch, before its first decision (S04, US-02).
export async function setBatchCriteria(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const criteriaVersionId = String(formData.get("criteriaVersionId") ?? "");
  if (!UUID.test(batchId)) back(batchId, "summary", MESSAGES.not_found);
  if (!UUID.test(criteriaVersionId)) back(batchId, "summary", MESSAGES.not_approved);

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "summary", MESSAGES.error);

  const { data, error } = await supabase.rpc("set_batch_criteria", {
    p_batch_id: batchId,
    p_criteria_version_id: criteriaVersionId,
  });
  if (error) {
    console.error("set_batch_criteria failed:", error.message);
    back(batchId, "summary", messageForError(error.message));
  }
  if (data !== "ok") {
    back(batchId, "summary", MESSAGES[String(data)] ?? MESSAGES.error);
  }

  revalidatePath(`/batches/${batchId}/summary`);
  revalidatePath(`/batches/${batchId}/screen`);
}

// Records a decision on one record (S07, US-04, US-05). The outcome is the button pressed.
export async function recordDecision(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const pmid = String(formData.get("pmid") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const freeText = String(formData.get("freeText") ?? "").trim();
  if (!UUID.test(batchId)) back(batchId, "screen", MESSAGES.not_found);
  if (!PMID.test(pmid) || !OUTCOMES.includes(outcome)) back(batchId, "screen", MESSAGES.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "screen", MESSAGES.error);

  const { data, error } = await supabase.rpc("record_screening_decision", {
    p_batch_id: batchId,
    p_record_pmid: pmid,
    p_outcome: outcome,
    p_reason_code: reason,
    p_free_text: freeText,
  });
  if (error) {
    console.error("record_screening_decision failed:", error.message);
    back(batchId, "screen", messageForError(error.message));
  }
  if (data !== "ok") {
    back(batchId, "screen", MESSAGES[String(data)] ?? MESSAGES.error);
  }

  revalidatePath(`/batches/${batchId}/screen`);
}

// Corrects a decision by adding a new event (S11, US-11). A reason is required.
export async function correctDecision(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const freeText = String(formData.get("freeText") ?? "").trim();
  if (!UUID.test(batchId)) back(batchId, "screen", MESSAGES.not_found);
  if (!UUID.test(eventId) || !OUTCOMES.includes(outcome)) back(batchId, "screen", MESSAGES.error);

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "screen", MESSAGES.error);

  const { data, error } = await supabase.rpc("correct_screening_decision", {
    p_event_id: eventId,
    p_outcome: outcome,
    p_reason_code: reason,
    p_free_text: freeText,
  });
  if (error) {
    console.error("correct_screening_decision failed:", error.message);
    back(batchId, "screen", messageForError(error.message));
  }
  if (data !== "ok") {
    back(batchId, "screen", MESSAGES[String(data)] ?? MESSAGES.error);
  }

  revalidatePath(`/batches/${batchId}/screen`);
}
