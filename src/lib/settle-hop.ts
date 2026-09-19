/**
 * Live default: Base mainnet USDC through the XPay facilitator (no auth).
 * Honor X402_FACILITATOR when set. CDP JWT only if keys are present and the
 * facilitator is Coinbase CDP. Sepolia only if X402_NETWORK=base-sepolia.
 */

export type Rail = "credits" | "x402" | "stripe" | "tiun" | "unknown";

export interface SettleHop {
  hop_id: string;
  job_id: string;
  meter: { egress_gb: number; compute_s: number; codec_s: number };
  amount_usd: number;
  key_id: string;
}

export const XPAY_FACILITATOR = "https://facilitator.xpay.sh";
export const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";

/** Operator funded-smoke + payment path docs (actionable settle errors). */
export const SETTLE_SMOKE_DOCS_URL =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/SETTLE_SMOKE.md";
export const PAYMENT_PATHS_DOCS_URL =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/PAYMENT_PATHS.md";

const PAY_TO =
  process.env.X402_PAY_TO ||
  process.env.X402_PAY_TO_BASE ||
  "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";

const LIVE = {
  // x402 v1 network name expected by XPay `/supported` (also match eip155:8453)
  network: "base",
  networkName: "base",
  caip2: "eip155:8453",
  symbol: "USDC",
  // Circle Base mainnet USDC EIP-712 domain name (not the ticker)
  eip712Name: "USD Coin",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  facilitator: XPAY_FACILITATOR,
  verifyPath: "/verify",
  settlePath: "/settle",
};

const TEST = {
  network: "base-sepolia",
  networkName: "base-sepolia",
  caip2: "eip155:84532",
  symbol: "USDC",
  eip712Name: "USDC", // Sepolia USDC domain differs from mainnet
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  facilitator: "https://x402.org/facilitator",
  verifyPath: "/verify",
  settlePath: "/settle",
};

const USDT_BASE = {
  network: "base",
  networkName: "base",
  caip2: "eip155:8453",
  symbol: "USDT",
  eip712Name: "USDT",
  asset: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  facilitator: XPAY_FACILITATOR,
  verifyPath: "/verify",
  settlePath: "/settle",
};

function isTestnet() {
  return (process.env.X402_NETWORK || "base") === "base-sepolia";
}

function rails() {
  if (isTestnet()) return [TEST];
  return [LIVE, USDT_BASE];
}

/** Resolved facilitator URL (trim trailing slash). Env wins when set. */
export function resolveFacilitator(fallback = LIVE.facilitator): string {
  const raw = process.env.X402_FACILITATOR || fallback;
  return raw.replace(/\/+$/, "");
}

/** True when this facilitator expects a Coinbase CDP JWT. */
export function usesCdpAuth(facilitatorUrl: string): boolean {
  try {
    return new URL(facilitatorUrl).hostname === "api.cdp.coinbase.com";
  } catch {
    return /api\.cdp\.coinbase\.com/i.test(facilitatorUrl);
  }
}

function networkMatches(
  rail: { network: string; networkName: string; caip2?: string },
  net: string
): boolean {
  if (!net) return true;
  return (
    rail.network === net ||
    rail.networkName === net ||
    rail.caip2 === net ||
    (rail.networkName === "base" && (net === "eip155:8453" || net === "base")) ||
    (rail.networkName === "base-sepolia" &&
      (net === "eip155:84532" || net === "base-sepolia"))
  );
}

export function parseKeyRail(keyId: string): { rail: Rail; rest: string } {
  const i = keyId.indexOf(":");
  if (i <= 0) return { rail: "unknown", rest: keyId };
  const prefix = keyId.slice(0, i);
  const rest = keyId.slice(i + 1);
  if (prefix === "credits" || prefix === "x402" || prefix === "stripe" || prefix === "tiun") {
    return { rail: prefix, rest };
  }
  return { rail: "unknown", rest: keyId };
}

export function parseCuniSettle(text: string): SettleHop | null {
  if (!text.startsWith("CUNI SettleHop")) return null;
  const get = (k: string) => {
    const line = text.split("\n").find((l) => l.startsWith(k + "="));
    return line ? line.slice(k.length + 1).trim() : "";
  };
  const meter = get("meter").split(",").map(Number);
  const hop_id = get("hop_id");
  const job_id = get("job_id");
  const key_id = get("key_id");
  const amount_usd = Number(get("amount_usd"));
  if (!hop_id || !job_id || !key_id) return null;
  return {
    hop_id,
    job_id,
    amount_usd: Number.isFinite(amount_usd) ? amount_usd : 0,
    key_id,
    meter: {
      egress_gb: meter[0] || 0,
      compute_s: meter[1] || 0,
      codec_s: meter[2] || 0,
    },
  };
}

function requirement(resource: string, amountUsd: number, r: (typeof LIVE)) {
  return {
    scheme: "exact",
    network: r.network,
    maxAmountRequired: String(Math.max(1, Math.round(amountUsd * 1_000_000))),
    asset: r.asset,
    payTo: PAY_TO,
    resource,
    description: `SettleHop ${r.symbol} ${r.networkName}`,
    mimeType: "application/json",
    outputSchema: null,
    maxTimeoutSeconds: 180,
    extra: { name: r.eip712Name || r.symbol, version: "2" },
  };
}

/**
 * Build headers for facilitator POST.
 * XPay and other public facilitators: JSON only (no CDP keys required).
 * CDP facilitator: attach JWT only when CDP_API_KEY_ID + CDP_API_KEY_SECRET
 * (or CDP_ACCESS_TOKEN) are present. Missing keys never throw — settle may
 * still call the facilitator; CDP will reject if auth is required there.
 */
export async function facilitatorHeaders(
  facilitator: string,
  method: string,
  path: string
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!usesCdpAuth(facilitator)) return headers;

  const id = process.env.CDP_API_KEY_ID;
  const secret = process.env.CDP_API_KEY_SECRET;
  if (id && secret) {
    try {
      const mod: any = await import("@coinbase/cdp-sdk/auth");
      const jwt = await mod.generateJwt({
        apiKeyId: id,
        apiKeySecret: secret,
        requestMethod: method,
        requestHost: "api.cdp.coinbase.com",
        requestPath: `/platform/v2/x402${path}`,
        expiresIn: 120,
      });
      headers.Authorization = `Bearer ${jwt}`;
      return headers;
    } catch {
      /* fall through to access token */
    }
  }
  if (process.env.CDP_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CDP_ACCESS_TOKEN}`;
  }
  return headers;
}

export async function settleX402(opts: {
  resource: string;
  paymentHeader: string | null;
  amountUsd: number;
}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const chosen = rails();
  const facilitator = resolveFacilitator(chosen[0].facilitator);
  const accepts = chosen.map((r) => requirement(opts.resource, opts.amountUsd, r));

  if (!opts.paymentHeader) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "payment_required",
        message: "Payment Required",
        x402Version: 1,
        accepts,
        rail: "stablecoin",
        live: !isTestnet(),
        facilitator,
        payment_header: "X-PAYMENT",
        hint:
          "Mint X-Agent-Rider (OPERATOR_JOIN), POST SettleHop with key_id=x402:<resource>, read accepts[], sign EIP-3009 Base USDC, retry with X-PAYMENT. Credits are not hop currency (410).",
        docs_url: SETTLE_SMOKE_DOCS_URL,
        payment_paths_url: PAYMENT_PATHS_DOCS_URL,
        next: [
          "POST /api/rider/issue with Bearer ar_…",
          "POST /api/settle without X-PAYMENT → 402 accepts",
          "Sign transferWithAuthorization for accepts[0]",
          "POST /api/settle with X-PAYMENT",
        ],
      },
    };
  }

  let payment: any = opts.paymentHeader;
  try {
    payment = JSON.parse(opts.paymentHeader);
  } catch {
    try {
      payment = JSON.parse(Buffer.from(opts.paymentHeader, "base64").toString("utf8"));
    } catch {
      return {
        ok: false,
        status: 400,
        body: {
          error: "bad_x402_header",
          hint: "X-PAYMENT must be JSON or base64(JSON) x402 PaymentPayload (scheme exact, network base, EIP-3009 authorization + signature).",
          docs_url: SETTLE_SMOKE_DOCS_URL,
          payment_header: "X-PAYMENT",
        },
      };
    }
  }

  const net = payment?.network || payment?.accepted?.network || "";
  const asset = (payment?.asset || payment?.accepted?.asset || "").toLowerCase();
  const rail =
    chosen.find(
      (r) =>
        networkMatches(r, net) &&
        (!asset || r.asset.toLowerCase() === asset)
    ) || chosen[0];
  const reqs = requirement(opts.resource, opts.amountUsd, rail);

  const post = async (path: string) => {
    const payload = JSON.stringify({
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: reqs,
    });
    const headers = await facilitatorHeaders(facilitator, "POST", path);
    const res = await fetch(`${facilitator}${path}`, {
      method: "POST",
      headers,
      body: payload,
    });
    return res.json().catch(() => ({ isValid: false, success: false, status: res.status }));
  };

  const verified = await post("/verify");
  if (!verified?.isValid) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "reject.funds",
        rail: "stablecoin",
        live: !isTestnet(),
        verified,
        accepts,
        hint:
          "Facilitator /verify failed. Check Base USDC balance, payTo matches accepts, authorization validAfter/validBefore window, asset address, and X-PAYMENT encoding.",
        docs_url: SETTLE_SMOKE_DOCS_URL,
        facilitator,
      },
    };
  }
  const settled = await post("/settle");
  if (!settled?.success) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "reject.funds",
        rail: "stablecoin",
        live: !isTestnet(),
        settled,
        accepts,
        hint:
          "Facilitator /settle failed after verify. Re-check nonce reuse, authorization expiry, and payTo. See SETTLE_SMOKE.md funded path.",
        docs_url: SETTLE_SMOKE_DOCS_URL,
        facilitator,
      },
    };
  }
  return {
    ok: true,
    status: 200,
    body: {
      rail: "stablecoin",
      live: !isTestnet(),
      asset: rail.symbol,
      network: rail.network,
      settled,
    },
  };
}
