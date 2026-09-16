/**
 * Hop currency: native Circle USDC only.
 * Rails: Base (eip155:8453) + Solana mainnet.
 * Facilitator: CDP on live; x402.org only on sepolia.
 * Pay addresses must not be mixed: SOL vs 0x.
 */

export type Rail = "credits" | "x402" | "stripe" | "tiun" | "unknown";

export interface SettleHop {
  hop_id: string;
  job_id: string;
  meter: { egress_gb: number; compute_s: number; codec_s: number };
  amount_usd: number;
  key_id: string;
}

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_CAIP = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const CDP = "https://api.cdp.coinbase.com/platform/v2/x402";
const TEST_FACILITATOR = "https://x402.org/facilitator";

const PAY_TO_BASE =
  process.env.X402_PAY_TO_BASE ||
  process.env.X402_PAY_TO_EVM ||
  (String(process.env.X402_PAY_TO || "").startsWith("0x") ? process.env.X402_PAY_TO : "") ||
  "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";

const PAY_TO_SOL =
  process.env.X402_PAY_TO_SOLANA ||
  (String(process.env.X402_PAY_TO || "").startsWith("0x") ? "" : process.env.X402_PAY_TO) ||
  "";

export const RAILS = {
  base: {
    id: "usdc-base",
    network: "eip155:8453",
    aliases: ["base", "base-mainnet", "eip155:8453"],
    symbol: "USDC",
    asset: USDC_BASE,
    payTo: PAY_TO_BASE,
    decimals: 6,
    facilitator: CDP,
    kind: "evm" as const,
  },
  solana: {
    id: "usdc-solana",
    network: SOLANA_CAIP,
    aliases: ["solana", "solana-mainnet-beta", SOLANA_CAIP],
    symbol: "USDC",
    asset: USDC_SOLANA,
    payTo: PAY_TO_SOL,
    decimals: 6,
    facilitator: CDP,
    kind: "solana" as const,
  },
  sepolia: {
    id: "usdc-base-sepolia",
    network: "eip155:84532",
    aliases: ["base-sepolia", "eip155:84532"],
    symbol: "USDC",
    asset: USDC_BASE_SEPOLIA,
    payTo: PAY_TO_BASE,
    decimals: 6,
    facilitator: TEST_FACILITATOR,
    kind: "evm" as const,
  },
};

function isTestnet() {
  return (process.env.X402_NETWORK || "live") === "base-sepolia";
}

function liveRails() {
  if (isTestnet()) return [RAILS.sepolia];
  const out = [RAILS.base];
  if (RAILS.solana.payTo) out.push(RAILS.solana);
  return out;
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

type LiveRail = (typeof RAILS)[keyof typeof RAILS];

function requirement(resource: string, amountUsd: number, r: LiveRail, network = r.network) {
  return {
    scheme: "exact" as const,
    network,
    maxAmountRequired: String(Math.max(1, Math.round(amountUsd * 10 ** r.decimals))),
    asset: r.asset,
    payTo: r.payTo,
    resource,
    description: `SettleHop USDC ${r.id}`,
    mimeType: "application/json",
    outputSchema: null,
    maxTimeoutSeconds: 180,
    extra: { name: "USDC", version: "2", id: r.id, kind: r.kind },
  };
}

function acceptList(resource: string, amountUsd: number) {
  const list: ReturnType<typeof requirement>[] = [];
  for (const r of liveRails()) {
    if (!r.payTo) continue;
    list.push(requirement(resource, amountUsd, r));
    for (const alias of r.aliases) {
      if (alias !== r.network) list.push(requirement(resource, amountUsd, r, alias));
    }
  }
  return list;
}

function matchRail(payment: any, accepts: ReturnType<typeof requirement>[]) {
  const net = String(payment?.network || payment?.accepted?.network || "").toLowerCase();
  const asset = String(payment?.asset || payment?.accepted?.asset || "").toLowerCase();
  const tx = payment?.payload?.transaction || payment?.payload?.txHash || payment?.payload?.signature;
  const ser = payment?.payload?.serializedTransaction;
  if (typeof tx === "string" && tx.startsWith("0x") && tx.length === 66) {
    return accepts.find((a) => String(a.network).includes("8453") || a.network === "base") || accepts[0];
  }
  if (ser) return accepts.find((a) => String(a.network).includes("solana")) || accepts[0];
  return (
    accepts.find(
      (a) =>
        (!net || String(a.network).toLowerCase() === net || String(a.extra.id).includes(net)) &&
        (!asset || a.asset.toLowerCase() === asset)
    ) || accepts[0]
  );
}

async function cdpHeaders(path: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const id = process.env.CDP_API_KEY_ID;
  const secret = process.env.CDP_API_KEY_SECRET;
  if (!id || !secret) return headers;
  try {
    const mod: any = await import("@coinbase/cdp-sdk/auth");
    const jwt = await mod.generateJwt({
      apiKeyId: id,
      apiKeySecret: secret,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: `/platform/v2/x402${path}`,
      expiresIn: 120,
    });
    headers.Authorization = `Bearer ${jwt}`;
  } catch {
    if (process.env.CDP_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.CDP_ACCESS_TOKEN}`;
  }
  return headers;
}

export async function settleX402(opts: {
  resource: string;
  paymentHeader: string | null;
  amountUsd: number;
}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const accepts = acceptList(opts.resource, opts.amountUsd);
  const facilitator = process.env.X402_FACILITATOR || (isTestnet() ? TEST_FACILITATOR : CDP);

  if (!opts.paymentHeader) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Payment Required",
        x402Version: 1,
        accepts,
        rail: "usdc",
        networks: liveRails().map((r) => r.network),
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

  const reqs = matchRail(payment, accepts) || accepts[0];
  if (!reqs) return { ok: false, status: 402, body: { error: "no_accepts", accepts } };

  const post = async (path: string) => {
    const payload = JSON.stringify({
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: reqs,
    });
    const headers = path.startsWith("/verify") || facilitator.includes("cdp.coinbase") ? await cdpHeaders(path) : { "content-type": "application/json" };
    const res = await fetch(`${facilitator}${path}`, { method: "POST", headers, body: payload });
    return res.json().catch(() => ({ isValid: false, success: false, http: res.status }));
  };

  const verified = await post("/verify");
  if (!verified?.isValid) {
    return { ok: false, status: 402, body: { error: "reject.funds", rail: "usdc", verified, accepts } };
  }
  const settled = await post("/settle");
  if (!settled?.success) {
    return { ok: false, status: 402, body: { error: "reject.funds", rail: "usdc", settled, accepts } };
  }
  return {
    ok: true,
    status: 200,
    body: { rail: "usdc", network: reqs.network, asset: reqs.asset, settled },
  };
}
