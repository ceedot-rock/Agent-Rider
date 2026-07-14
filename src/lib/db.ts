import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client (service role key). Every caller of this module runs in
// an API route handler, never in client-rendered code — do not import this
// from a "use client" component.
let client: SupabaseClient | null = null;

export function getDB(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables. See .env.example and supabase/schema.sql."
    );
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
