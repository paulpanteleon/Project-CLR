import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

// Server-only Supabase client for Server Components, Server Actions, and route code.
// Returns null when the Supabase settings are missing, so pages can say so
// instead of crashing. The publishable key is safe to use here, and the
// secret keys are never read by this app.
export async function createSupabaseServerClient() {
  const config = supabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components cannot set cookies. The session is refreshed in src/proxy.ts,
        // so a failed write here is safe to ignore.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Ignored on purpose. See the note above.
        }
      },
    },
  });
}
