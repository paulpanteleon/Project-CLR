"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Screening criteria (US-02, US-12, FR-DR-06, ADR-0013). The app checks the shape of the
// input. The database makes the decisions: who may draft, approve, or lock, and what may
// change. Each function returns a result word, which is turned into a message here.

export type DraftState = { error: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_CODE = /^[A-Z][A-Z0-9-]*$/;

const FIELDS = ["review_name", "review_topic", "population", "intervention", "comparator", "outcomes", "design", "dates"] as const;

const MESSAGES: Record<string, string> = {
  denied: "Only a medical writer can draft criteria. Only a clinical affairs lead can approve or lock them.",
  own_draft: "You cannot approve a draft you wrote. A clinical affairs lead must approve it.",
  not_found: "That criteria version no longer exists.",
  not_draft: "Only a draft can be approved. This version has already been approved.",
  not_approved: "Only an approved version can be locked.",
  already_locked: "This version is already locked.",
  error: "The change could not be saved. Try again.",
};

// Reads one reason per line as "CODE: label". Codes are upper-cased.
function parseReasons(text: string): { reasons: { code: string; label: string }[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { reasons: [], error: "Add at least one reason, one per line, as CODE: label." };
  }

  const reasons: { code: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^([^:]+):\s*(.+)$/.exec(line);
    if (!match) {
      return { reasons: [], error: `Write each reason as CODE: label. Check "${line}".` };
    }
    const code = match[1].trim().toUpperCase();
    if (!REASON_CODE.test(code)) {
      return { reasons: [], error: `The reason code "${match[1].trim()}" can use letters, digits and hyphens only.` };
    }
    if (seen.has(code)) {
      return { reasons: [], error: `The reason code ${code} is used more than once.` };
    }
    seen.add(code);
    reasons.push({ code, label: match[2].trim() });
  }
  return { reasons, error: null };
}

// Drafts a new version of a review's criteria (S13). Only a medical writer can draft.
export async function draftCriteriaVersion(_previous: DraftState, formData: FormData): Promise<DraftState> {
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    values[field] = String(formData.get(field) ?? "").trim();
    if (values[field].length === 0) {
      return { error: `Fill in ${field.replace("_", " ")}.` };
    }
  }

  const { reasons, error: reasonError } = parseReasons(String(formData.get("reasons") ?? ""));
  if (reasonError) {
    return { error: reasonError };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Sign-in is not set up yet. The Supabase settings are missing." };
  }

  const id = randomUUID();
  const { data, error } = await supabase.rpc("create_criteria_version", {
    p_id: id,
    p_review_name: values.review_name,
    p_review_topic: values.review_topic,
    p_population: values.population,
    p_intervention: values.intervention,
    p_comparator: values.comparator,
    p_outcomes: values.outcomes,
    p_design: values.design,
    p_dates: values.dates,
    p_reasons: reasons,
  });

  if (error) {
    console.error("create_criteria_version failed:", error.message);
    return { error: error.message.includes("at least one reason") ? "Add at least one reason." : MESSAGES.error };
  }
  if (data !== "ok") {
    return { error: MESSAGES[String(data)] ?? MESSAGES.error };
  }

  // redirect() ends the request, so it must stay outside any try block.
  revalidatePath("/criteria");
  redirect("/criteria");
}

// Approves a draft (US-12). The database refuses the drafter approving their own draft.
export async function approveCriteriaVersion(formData: FormData) {
  await changeStatus(formData, "approve_criteria_version");
}

// Locks an approved version, so it can no longer be used for new work.
export async function lockCriteriaVersion(formData: FormData) {
  await changeStatus(formData, "lock_criteria_version");
}

async function changeStatus(formData: FormData, fn: "approve_criteria_version" | "lock_criteria_version") {
  const id = String(formData.get("criteriaVersionId") ?? "");
  if (!UUID.test(id)) {
    redirect(`/criteria?error=${encodeURIComponent(MESSAGES.error)}`);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(`/criteria?error=${encodeURIComponent(MESSAGES.error)}`);
  }

  const { data, error } = await supabase.rpc(fn, { p_id: id });
  if (error) {
    console.error(`${fn} failed:`, error.message);
  }
  if (error || data !== "ok") {
    const key = error ? "error" : String(data);
    redirect(`/criteria?error=${encodeURIComponent(MESSAGES[key] ?? MESSAGES.error)}`);
  }

  revalidatePath("/criteria");
}
