/**
 * Minimal @supabase/supabase-js stand-in for disk-only selftests.
 * createClient throws so getDB() fails closed and lib code falls back
 * to the disk store. NEVER import from production code.
 */
export function createClient() {
  throw new Error("supabase-stub: disk-only selftest, no Supabase client");
}
