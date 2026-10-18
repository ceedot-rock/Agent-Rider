/**
 * Agent-Rider client: constants, register/issue, and scoped messaging.
 * Never logs api_key / rider JWT. Live host is Fly only.
 */

import { requestJson } from "./transport.mjs";
export { RiderApiError } from "./transport.mjs";
export { createRiderClient } from "./client.mjs";

export const LIVE_BASE = "https://agentrider.fly.dev";
export const MCP_URL = `${LIVE_BASE}/api/mcp`;
export const PUBLIC_CASH_URL = "https://www.slidphilabs.com/pcc";
export const DISCOVERY_URL = `${LIVE_BASE}/api/discovery`;
export const JWKS_URL = `${LIVE_BASE}/.well-known/jwks.json`;
export const REVOCATION_URL = `${LIVE_BASE}/.well-known/rider-revocation.json`;
export const AGENTS_URL = `${LIVE_BASE}/api/agents`;
export const RIDER_ISSUE_URL = `${LIVE_BASE}/api/rider/issue`;

/**
 * @param {{ name: string, type?: "agent"|"human", operator_id?: string,
 * promo_code?: string, referral_code?: string, capabilities?: string[],
 * base?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} input
 */
export async function registerSeat(input) {
  const base = input.base ?? LIVE_BASE;
  return requestJson(base, "/api/agents", {
    method: "POST",
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    body: {
      name: input.name,
      type: input.type ?? "agent",
      operator_id: input.operator_id ?? "sandbox",
      promo_code: input.promo_code,
      referral_code: input.referral_code,
      capabilities: input.capabilities,
    },
  });
}

/**
 * Mint L1 rider JWT from a vaulted ar_ key. Does not echo the key.
 * @param {string} apiKey
 * @param {{ level?: string, scopes?: string[], base?: string,
 * fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function issueRider(apiKey, opts = {}) {
  if (typeof apiKey !== "string" || !apiKey.startsWith("ar_")) {
    throw new Error("invalid_api_key_shape");
  }
  const base = opts.base ?? LIVE_BASE;
  return requestJson(base, "/api/rider/issue", {
    method: "POST",
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      level: opts.level ?? "L1",
      scopes: opts.scopes ?? ["*"],
    },
  });
}

/** Machine try_path from live discovery (free → paid pointers). */
export { verifyRiderCredential, ISSUER } from "./verify.mjs";

export async function fetchTryPath(base = LIVE_BASE) {
  const body = await requestJson(base, "/api/discovery");
  return body.try_path ?? null;
}

export const tryPath = {
  free: {
    register: "POST /api/agents or MCP tool register",
    issue: "POST /api/rider/issue (Authorization: Bearer ar_…)",
    mcp: MCP_URL,
  },
  paid: {
    public_cash: PUBLIC_CASH_URL,
    note: "Sole public cash face. Board AGC Stripe / Rider checkout are not a second public cash CTA. Hop settle is Base USDC via XPay.",
  },
};
