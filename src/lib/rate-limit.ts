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

// POST /api/checkout has no rider gate — it's meant to be callable by an
// anonymous visitor before they have any credential, so it's keyed by IP
// instead of agent_id. Without this, anyone could script unlimited real
// Stripe Checkout Session creations for free. 5/hour is generous for a
// real visitor (checkout is a rare, deliberate action — nobody legitimately
// needs more than a couple of attempts) while shutting down scripted abuse.
export function checkCheckoutLimit(ip: string) {
  return checkRateLimit(`checkout:${ip}`, 5, 3600);
}

// GET /api/provision is also unauthenticated (the success page calls it
// with only a session_id) and makes a real Stripe API call per request.
// Session IDs are long, random, and Stripe-generated, so this isn't a
// guessable-secret risk — the point of rate limiting it is to stop someone
// from flooding it with garbage IDs to burn Stripe API quota. More
// permissive than checkout itself since the docs' own eventual-consistency
// note ("retry briefly right after checkout") means a few legitimate
// retries in quick succession are expected.
export function checkProvisionLimit(ip: string) {
  return checkRateLimit(`provision:${ip}`, 20, 600);
}

// Calendar-month usage counter, reusing the same rate_limits table +
// increment_rate_limit() RPC as the fixed-window limiters above but with
// window_start pinned to the 1st of the current UTC month instead of a
// fixed-size slice — months aren't a constant number of seconds, so the
// floor-division trick checkRateLimit() uses doesn't apply here.
export async function checkMonthlyUsage(
  key: string,
  freeLimit: number
): Promise<{ count: number; overLimit: boolean; monthStart: string }> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data, error } = await getDB().rpc("increment_rate_limit", {
    _key: key,
    _window_start: monthStart,
  });

  if (error) {
    // Fail open — a metering outage shouldn't take down merchant verification.
    console.error("checkMonthlyUsage: increment_rate_limit failed", error.message);
    return { count: 0, overLimit: false, monthStart };
  }

  const count = data as number;
  return { count, overLimit: count > freeLimit, monthStart };
}

// POST /api/credits/purchase is rider-gated (real agent_id known, unlike
// checkout/provision above) but still hits Stripe's Checkout API per call —
// same 5/hour ceiling and reasoning as checkCheckoutLimit, keyed by agent
// instead of IP since we have a real identity here.
export function checkCreditsPurchaseLimit(agentId: string) {
  return checkRateLimit(`credits_purchase:${agentId}`, 5, 3600);
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
