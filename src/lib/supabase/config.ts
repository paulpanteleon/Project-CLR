// Reads the Supabase settings from environment variables. Set them in
// .env.local for development and in Vercel's environment settings for production.
// Never commit real values (S-4). See .env.example for the names.
export type SupabaseConfig = { url: string; publishableKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
