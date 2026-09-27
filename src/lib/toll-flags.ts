/**
 * Toll 1 + Toll 2 feature flags — default OFF.
 * Live only when env is explicitly "1" or "true" (case-insensitive).
 * Do not flip LIVE in this PR; CoS greens a separate smoke before ops sets these.
 */

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Metered rider-JWT verify at POST /api/toll/v1/verify. Default OFF. */
export function isToll1MeterLive(): boolean {
  return envFlagOn("TOLL1_METER_LIVE");
}

/** Metered verified-capability lookup at POST /api/toll/v2/lookup. Default OFF. */
export function isToll2LookupLive(): boolean {
  return envFlagOn("TOLL2_LOOKUP_LIVE");
}

/** Stripe $9/mo promote at POST /api/toll/v2/promote. Default OFF. */
export function isToll2PromoteLive(): boolean {
  return envFlagOn("TOLL2_PROMOTE_LIVE");
}

export const TOLL1_OFF_BODY = {
  error: "toll1_meter_off" as const,
  live: false as const,
  hint: "TOLL1_METER_LIVE is off (default). Free verify stays at POST /api/rider/verify and GET /.well-known/jwks.json. Set TOLL1_METER_LIVE=1 only after Stripe meter smoke.",
  free_paths: ["POST /api/rider/verify", "GET /.well-known/jwks.json"],
  metered_path: "POST /api/toll/v1/verify",
  price_usd_when_live: 0.005,
  free_tier_when_live: 100,
};

export const TOLL2_LOOKUP_OFF_BODY = {
  error: "toll2_lookup_off" as const,
  live: false as const,
  hint: "TOLL2_LOOKUP_LIVE is off (default). Free capability upsert/get stay at /api/capabilities. Discovery and registry stay free. Set TOLL2_LOOKUP_LIVE=1 only after Stripe meter smoke.",
  free_paths: ["POST /api/capabilities", "GET /api/capabilities/{id}", "GET /api/discovery", "GET /api/registry"],
  metered_path: "POST /api/toll/v2/lookup",
  price_usd_when_live: 0.02,
};

export const TOLL2_PROMOTE_OFF_BODY = {
  error: "toll2_promote_off" as const,
  live: false as const,
  hint: "TOLL2_PROMOTE_LIVE is off (default). Promote is a stub until Stripe $9/mo price is wired and smoked.",
  metered_path: "POST /api/toll/v2/promote",
  price_usd_mo_when_live: 9,
};
