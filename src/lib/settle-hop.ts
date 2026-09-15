/**
 * Live default: Base mainnet USDC through CDP facilitator.
 * Sepolia only if X402_NETWORK=base-sepolia.
 */

export type Rail = "credits" | "x402" | "stripe" | "tiun" | "unknown";

export interface SettleHop {
  hop_id: string;
  job_id: string;
  meter: { egress_gb: number; compute_s: number; codec_s: number };
  amount_usd: number;
  key_id: string;
}

const PAY_TO =
  process.env.X402_PAY_TO || "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";

const LIVE = {
  network: "eip155:8453",
  networkName: "base",
  symbol: "USDC",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
  verifyPath: "/verify",
  settlePath: "/settle",
};

const TEST = {
  network: "eip155:84532",
  networkName: "base-sepolia",
  symbol: "USDC",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  facilitator: "https://x402.org/facilitator",
  verifyPath: "/verify",
  settlePath: "/settle",
};

const USDT_BASE = {
  network: "eip155:8453",
  networkName: "base",
  symbol: "USDT",
  asset: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  facilitator: LIVE.facilitator,
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
    extra: { name: r.symbol, version: "2" },
  };
}

async function cdpHeaders(method: string, path: string, body: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const id = process.env.CDP_API_KEY_ID;
  const secret = process.env.CDP_API_KEY_SECRET;
  if (!id || !secret) return headers;
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
  } catch {
    if (process.env.CDP_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.CDP_ACCESS_TOKEN}`;
    }
  }
  return headers;
}

export async function settleX402(opts: {
  resource: string;
  paymentHeader: string | null;
  amountUsd: number;
}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const chosen = rails();
  const facilitator = process.env.X402_FACILITATOR || chosen[0].facilitator;
  const accepts = chosen.map((r) => requirement(opts.resource, opts.amountUsd, r));

  if (!opts.paymentHeader) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Payment Required",
        x402Version: 1,
        accepts,
        rail: "stablecoin",
        live: !isTestnet(),
        facilitator,
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
      return { ok: false, status: 400, body: { error: "bad_x402_header" } };
    }
  }

  const net = payment?.network || payment?.accepted?.network;
  const asset = (payment?.asset || payment?.accepted?.asset || "").toLowerCase();
  const rail =
    chosen.find((r) => (!net || r.network === net || r.networkName === net) && (!asset || r.asset.toLowerCase() === asset)) ||
    chosen[0];
  const reqs = requirement(opts.resource, opts.amountUsd, rail);

  const post = async (path: string) => {
    const payload = JSON.stringify({
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: reqs,
    });
    const headers = await cdpHeaders("POST", path, payload);
    const res = await fetch(`${facilitator}${path}`, { method: "POST", headers, body: payload });
    return res.json().catch(() => ({ isValid: false, success: false, status: res.status }));
  };

  const verified = await post("/verify");
  if (!verified?.isValid) {
    return {
      ok: false,
      status: 402,
      body: { error: "reject.funds", rail: "stablecoin", live: !isTestnet(), verified, accepts },
    };
  }
  const settled = await post("/settle");
  if (!settled?.success) {
    return {
      ok: false,
      status: 402,
      body: { error: "reject.funds", rail: "stablecoin", live: !isTestnet(), settled, accepts },
    };
  }
  return {
    ok: true,
    status: 200,
    body: { rail: "stablecoin", live: !isTestnet(), asset: rail.symbol, network: rail.network, settled },
  };
}
