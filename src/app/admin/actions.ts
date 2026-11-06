"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Admin actions (US-15, US-21). Each one calls a database function that checks the caller
// is an owner and writes the audit row (ADR-0012). The app only passes the request on and
// shows the result.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_TYPES = ["medical_writer", "clinician_reviewer", "clinical_affairs_lead"];
const PERMISSION_LEVELS = ["read_only", "reviewer", "owner"];

const MESSAGES: Record<string, string> = {
  denied: "Only an owner can make this change.",
  last_owner: "At least one owner must remain, so this change was not saved.",
  not_found: "That user has no role record yet.",
  error: "The change could not be saved. Try again.",
};

function refuse(result: string | null, failed: boolean): never {
  const key = failed ? "error" : (result ?? "error");
  redirect(`/admin/users?error=${encodeURIComponent(MESSAGES[key] ?? MESSAGES.error)}`);
}

export async function setRole(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const userType = String(formData.get("userType") ?? "");
  const permissionLevel = String(formData.get("permissionLevel") ?? "");
  if (!UUID.test(userId) || !USER_TYPES.includes(userType) || !PERMISSION_LEVELS.includes(permissionLevel)) {
    refuse("error", true);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) refuse("error", true);

  const { data, error } = await supabase.rpc("admin_set_role", {
    p_user_id: userId,
    p_user_type: userType,
    p_permission_level: permissionLevel,
  });
  if (error || data !== "ok") refuse(typeof data === "string" ? data : null, error !== null);

  revalidatePath("/admin/users");
}

export async function requestReset(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) refuse("error", true);

  const supabase = await createSupabaseServerClient();
  if (!supabase) refuse("error", true);

  const { data, error } = await supabase.rpc("admin_request_reset", { p_user_id: userId });
  if (error || data !== "ok") refuse(typeof data === "string" ? data : null, error !== null);

  revalidatePath("/admin/users");
}
