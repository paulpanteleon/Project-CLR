import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

// Admin client with the secret key. It bypasses row-level security, so use it only where
// the caller has already been checked (ADR-0012): listing users on the admin page, and
// removing a user's authenticator when a reset is pending. Never pass it to a client
// component. Returns null when the key is missing.
export function createSupabaseAdminClient() {
  const config = supabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!config || !secretKey) return null;

  return createClient(config.url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
