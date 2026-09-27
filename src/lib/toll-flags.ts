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

// ── Tollkeeper Tolls 3–7 (dark; default OFF) ────────────────────────────────
// Same convention: env "1"/"true" flips live. Do not flip LIVE in this PR;
// CoS greens a separate smoke before ops sets these.

/** Toll 3 — escrow lock/release. Default OFF. */
export function isToll3EscrowLive(): boolean {
  return envFlagOn("TOLL3_ESCROW_LIVE");
}

/** Toll 4 — Warrant-compatible grant issue/check. Default OFF. */
export function isToll4GrantsLive(): boolean {
  return envFlagOn("TOLL4_GRANTS_LIVE");
}

/** Toll 5 — exactness attestation check. Default OFF. */
export function isToll5CheckLive(): boolean {
  return envFlagOn("TOLL5_CHECK_LIVE");
}

/** Toll 6 — bond stake/slash. Default OFF. */
export function isToll6BondsLive(): boolean {
  return envFlagOn("TOLL6_BONDS_LIVE");
}

/** Toll 7 — portable-memory hosted transfer. Default OFF. */
export function isToll7MemoryLive(): boolean {
  return envFlagOn("TOLL7_MEMORY_LIVE");
}

export const TOLL3_ESCROW_OFF_BODY = {
  error: "toll3_escrow_off" as const,
  live: false as const,
  hint: "TOLL3_ESCROW_LIVE is off (default). Escrow stays local-only. Set TOLL3_ESCROW_LIVE=1 only after CoS smoke green.",
  metered_path: "POST /api/toll/v3/escrow",
  toll_when_live: "1% routing fee at lock (integer micro-USDC)",
};

export const TOLL4_GRANTS_OFF_BODY = {
  error: "toll4_grants_off" as const,
  live: false as const,
  hint: "TOLL4_GRANTS_LIVE is off (default). Grant issue/check stay local-only. Set TOLL4_GRANTS_LIVE=1 only after CoS smoke green.",
  metered_path: "POST /api/toll/v4/grants/issue",
  price_usd_when_live: { issue: 0.01, check: 0.005 },
};

export const TOLL5_CHECK_OFF_BODY = {
  error: "toll5_check_off" as const,
  live: false as const,
  hint: "TOLL5_CHECK_LIVE is off (default). Exactness checks stay local-only (stub gate). Set TOLL5_CHECK_LIVE=1 only after CoS smoke green.",
  metered_path: "POST /api/toll/v5/check",
  price_usd_when_live: 0.1,
};

export const TOLL6_BONDS_OFF_BODY = {
  error: "toll6_bonds_off" as const,
  live: false as const,
  hint: "TOLL6_BONDS_LIVE is off (default). Bond stake/slash stay local-only (mocked settlement). Set TOLL6_BONDS_LIVE=1 only after CoS smoke green.",
  metered_path: "POST /api/toll/v6/bonds/stake",
  toll_when_live: "1% of bonded value at stake (integer micro-USDC)",
};

export const TOLL7_MEMORY_OFF_BODY = {
  error: "toll7_memory_off" as const,
  live: false as const,
  hint: "TOLL7_MEMORY_LIVE is off (default). Hosted memory transfer stays local-only. Set TOLL7_MEMORY_LIVE=1 only after CoS smoke green.",
  metered_path: "POST /api/toll/v7/memory/export",
  price_usd_when_live: 0.02,
};
