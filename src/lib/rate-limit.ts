import { getDB } from "@/lib/db";

// Fixed-window rate limiting on the generic `rate_limits` table +
// `increment_rate_limit()` RPC (supabase/schema.sql) — added during the DB
// layer pass for exactly this, unused until AgenticLive's comms port needed
// it. One shared limiter instead of AgenticLive's original per-subsystem
// checkAgentWriteLimit/checkSignupLimit pair.
export async function checkRateLimit(
  key: string,
  maxPerWindow: number,
  windowSeconds: number
): Promise<{ ok: boolean; retryAfter: number }> {
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  ).toISOString();

  const { data, error } = await getDB().rpc("increment_rate_limit", {
    _key: key,
    _window_start: windowStart,
  });

  if (error) {
    // Fail open — a rate-limit outage shouldn't take down writes platform-wide.
    console.error("checkRateLimit: increment_rate_limit failed", error.message);
    return { ok: true, retryAfter: 0 };
  }

  return { ok: (data as number) <= maxPerWindow, retryAfter: windowSeconds };
}

// Matches AgenticLive's original limits: 30 writes/minute per agent across
// thoughts+queries+predictions combined (one shared bucket, not one per
// table — an agent spamming across all three still hits the same wall).
export function checkAgentWriteLimit(agentId: string) {
  return checkRateLimit(`comms_write:${agentId}`, 30, 60);
}
