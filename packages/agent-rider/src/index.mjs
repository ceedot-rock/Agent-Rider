/**
 * Thin Agent-Rider client — constants + register/issue helpers.
 * Never logs api_key / rider JWT. Live host is Fly only.
 */

export const LIVE_BASE = "https://agentrider.fly.dev";
export const MCP_URL = `${LIVE_BASE}/api/mcp`;
export const PUBLIC_CASH_URL = "https://www.slidphilabs.com/pcc";
export const DISCOVERY_URL = `${LIVE_BASE}/api/discovery`;
export const JWKS_URL = `${LIVE_BASE}/.well-known/jwks.json`;
export const AGENTS_URL = `${LIVE_BASE}/api/agents`;
export const RIDER_ISSUE_URL = `${LIVE_BASE}/api/rider/issue`;

/**
 * @param {{ name: string, type?: "agent"|"human", operator_id?: string, base?: string }} input
 */
export async function registerSeat(input) {
  const base = input.base ?? LIVE_BASE;
  const res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      type: input.type ?? "agent",
      operator_id: input.operator_id ?? "sandbox",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `register_failed_${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Mint L1 rider JWT from a vaulted ar_ key. Does not echo the key.
 * @param {string} apiKey
 * @param {{ level?: string, scopes?: string[], base?: string }} [opts]
 */
export async function issueRider(apiKey, opts = {}) {
  if (typeof apiKey !== "string" || !apiKey.startsWith("ar_")) {
    throw new Error("invalid_api_key_shape");
  }
  const base = opts.base ?? LIVE_BASE;
  const res = await fetch(`${base}/api/rider/issue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      level: opts.level ?? "L1",
      scopes: opts.scopes ?? ["*"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `issue_failed_${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Machine try_path from live discovery (free → paid pointers). */
export async function fetchTryPath(base = LIVE_BASE) {
  const res = await fetch(`${base}/api/discovery`);
  const body = await res.json();
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
