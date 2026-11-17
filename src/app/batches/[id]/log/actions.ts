"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EXPIRY_DAYS } from "@/lib/review-log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Creates and withdraws share links for a batch's review log (US-13, ADR-0020). The link carries a
// random token. The database keeps only the token's hash, so the full link is shown once, here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShareState = {
  error: string | null;
  link?: string;
  recipient?: string | null;
  days?: number;
};

const SHARE_MESSAGES: Record<string, string> = {
  not_found: "That batch could not be found.",
  denied: "Only the batch's creator or an owner can share its review log.",
  invalid_expiry: "Choose how long the link should work.",
  unknown_recipient: "No one with a role has that email. Check it, or leave it empty for an open link.",
};

const REVOKE_MESSAGES: Record<string, string> = {
  not_found: "That link could not be found.",
  denied: "Only the batch's creator or an owner can withdraw its links.",
  already_ended: "That link had already expired or been withdrawn.",
};

// The site's own address, as the browser reached it, so the link works where it was made.
async function siteOrigin() {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const protocol = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function createShareLink(_previous: ShareState, formData: FormData): Promise<ShareState> {
  const batchId = String(formData.get("batchId") ?? "");
  const days = Number(formData.get("days"));
  const email = String(formData.get("email") ?? "").trim();
  if (!UUID.test(batchId)) return { error: SHARE_MESSAGES.not_found };
  if (!EXPIRY_DAYS.includes(days as (typeof EXPIRY_DAYS)[number])) return { error: SHARE_MESSAGES.invalid_expiry };
  if (email.length > 320) return { error: SHARE_MESSAGES.unknown_recipient };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Sign-in is not set up. Check .env.local." };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const { data, error } = await supabase.rpc("create_review_log_share", {
    p_batch_id: batchId,
    p_token_hash: tokenHash,
    p_recipient_email: email || null,
    p_days: days,
  });
  const created = (Array.isArray(data) ? data[0] : data) as { result: string } | null;
  if (error || !created) {
    if (error) console.error("create_review_log_share failed:", error.message);
    return { error: "The link could not be created. Try again." };
  }
  if (created.result !== "ok") {
    return { error: SHARE_MESSAGES[created.result] ?? "The link could not be created. Try again." };
  }

  revalidatePath(`/batches/${batchId}/log`);
  return { error: null, link: `${await siteOrigin()}/shared/${token}`, recipient: email || null, days };
}

function back(batchId: string, param: "error" | "notice", message: string): never {
  redirect(`/batches/${batchId}/log?${param}=${encodeURIComponent(message)}`);
}

export async function revokeShareLink(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const shareId = String(formData.get("shareId") ?? "");
  if (!UUID.test(batchId)) redirect("/batches");
  if (!UUID.test(shareId)) back(batchId, "error", REVOKE_MESSAGES.not_found);

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(batchId, "error", "Sign-in is not set up. Check .env.local.");

  const { data, error } = await supabase.rpc("revoke_review_log_share", { p_share_id: shareId });
  if (error) {
    console.error("revoke_review_log_share failed:", error.message);
    back(batchId, "error", "The link could not be withdrawn. Try again.");
  }
  if (data !== "ok") back(batchId, "error", REVOKE_MESSAGES[String(data)] ?? "The link could not be withdrawn. Try again.");

  revalidatePath(`/batches/${batchId}/log`);
  back(batchId, "notice", "Link withdrawn. It no longer opens the review log.");
}
