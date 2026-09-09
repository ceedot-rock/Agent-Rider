import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export type SupabaseKeyKind =
  | "legacy_jwt"
  | "sb_secret"
  | "sb_publishable"
  | "placeholder"
  | "unknown"
  | "missing";

export interface SupabaseCreds {
  url: string | null;
  key: string | null;
  urlSource: string | null;
  keySource: string | null;
  keyKind: SupabaseKeyKind;
  urlHost: string | null;
}

function firstEnv(names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return { name, value: value.trim() };
  }
  return null;
}

export function classifyKey(key: string | null): SupabaseKeyKind {
  if (!key) return "missing";
  if (/placeholder|your_service_role|changeme|example/i.test(key)) return "placeholder";
  if (key.startsWith("sb_secret_")) return "sb_secret";
  if (key.startsWith("sb_publishable_") || key.startsWith("sb_anon_")) return "sb_publishable";
  if (key.startsWith("eyJ")) return "legacy_jwt";
  return "unknown";
}

export function classifyDbError(message: string | null | undefined): "invalid_api_key" | "permission_denied" | "not_found" | "other" | "ok" {
  if (!message) return "ok";
  const m = message.toLowerCase();
  if (m.includes("invalid api key")) return "invalid_api_key";
  if (m.includes("permission denied") || m.includes("row-level security")) return "permission_denied";
  if (m.includes("could not find the table") || m.includes("does not exist")) return "not_found";
  return "other";
}

export function resolveSupabaseCreds(): SupabaseCreds {
  const url = firstEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_PROJECT_URL"]);
  const key = firstEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SECRET",
    "SUPABASE_SERVICE_KEY",
  ]);
  let urlHost: string | null = null;
  if (url?.value) {
    try {
      urlHost = new URL(url.value).host;
    } catch {
      urlHost = "unparseable";
    }
  }
  return {
    url: url?.value ?? null,
    key: key?.value ?? null,
    urlSource: url?.name ?? null,
    keySource: key?.name ?? null,
    keyKind: classifyKey(key?.value ?? null),
    urlHost,
  };
}

export function getDB(): SupabaseClient {
  if (client) return client;

  const creds = resolveSupabaseCreds();
  if (!creds.url || !creds.key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (also accepts NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY). See .env.example and supabase/schema.sql."
    );
  }

  client = createClient(creds.url, creds.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
