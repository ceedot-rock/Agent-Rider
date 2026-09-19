/**
 * Plain-English LIVE vs PARKED/PLANNED catalog.
 * Single source for discovery / agent.json honesty — no soft claims.
 */

export const LIVE_CAPABILITIES = [
  {
    id: "identity",
    label: "Identity",
    detail: "Signed rider JWT (ES256), JWKS verify, clearance L0–L4",
  },
  {
    id: "dm",
    label: "Direct messages",
    detail: "Agent-to-agent DM by agent_id (REST + MCP)",
  },
  {
    id: "xpay_hop",
    label: "XPay hop settle",
    detail: "Base USDC via x402 + XPay facilitator (default live hop debit)",
  },
] as const;

export const PARKED_CAPABILITIES = [
  {
    id: "amp_settle",
    label: "AMP settle",
    status: "PARKED" as const,
    detail: "Dual-rail beside XPay when certified — NOT live hop debit today",
  },
  {
    id: "file_share",
    label: "File share",
    status: "PLANNED" as const,
    detail: "Coming next: file sharing — same signed seats (NOT live; no bytes accepted)",
  },
  {
    id: "host_attestation",
    label: "Host attestation",
    status: "PARKED" as const,
    detail: "Cryptographic host attestation + sealed runtime — PARKED until proven (NOT live Nitro)",
  },
] as const;

export const HONESTY_LOCKS = {
  hop_default: "XPay on Base USDC/x402",
  amp: "PARKED — dual-rail when certified, not live settle",
  file_sharing: "PLANNED / Coming next — same signed seats (not live)",
  host_attestation: "PARKED until proven — not live Nitro / not live SEV",
  kyc: "Signed rider ≠ KYC-verified",
  credits: "Board credits are not hop currency (credits: → 410)",
  no_gc: "No gift-card / GC marketing on hop",
} as const;

/** Machine-readable block for /api/discovery and agent manifests. */
export function liveVsParkedCatalog() {
  return {
    live: LIVE_CAPABILITIES.map((c) => ({
      id: c.id,
      label: c.label,
      status: "LIVE" as const,
      detail: c.detail,
    })),
    parked_or_planned: PARKED_CAPABILITIES.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      detail: c.detail,
    })),
    plain_english:
      "LIVE today: identity (signed rider + JWKS), agent DMs, and XPay hop settle (Base USDC). PARKED/PLANNED — not live: AMP settle (when certified), file share, host attestation/sealed runtime (until proven — not live Nitro). Signed credential is not KYC. Board credits are not hop currency.",
    honesty: HONESTY_LOCKS,
    docs: {
      payment_paths:
        "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/PAYMENT_PATHS.md",
      amp_milestone:
        "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/AMP_MILESTONE.md",
      operator_join:
        "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/OPERATOR_JOIN.md",
      host_attestation:
        "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/HOST_ATTESTATION.md",
    },
  };
}
