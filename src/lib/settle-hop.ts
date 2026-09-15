/**
 * One clerk entry for every payment rail the lab actually uses.
 *
 * key_id prefix selects the rail:
 *   credits:<agentId>     Rider AGC ledger (live debit)
 *   x402:<resource>       facilitator verify + settle (USDC testnet)
 *   stripe:<priceId>      human checkout only — not a hop debit
 *   tiun:<productId>      human entitlement only — not a hop debit
 *   key_site_*            treated as credits if RIDER default, else reject.funds
 */

export type Rail = "credits" | "x402" | "stripe" | "tiun" | "unknown";

export interface SettleHop {
  hop_id: string;
  job_id: string;
  meter: { egress_gb: number; compute_s: number; codec_s: number };
  amount_usd: number;
  key_id: string;
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

export async function settleX402(opts: {
  resource: string;
  paymentHeader: string | null;
  amountUsd: number;
}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const facilitator = process.env.X402_FACILITATOR || "https://x402.org/facilitator";
  const network = process.env.X402_NETWORK || "base-sepolia";
  const asset =
    process.env.X402_ASSET || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const payTo =
    process.env.X402_PAY_TO || "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";
  const atomic = String(Math.max(1, Math.round(opts.amountUsd * 1_000_000)));
  const reqs = {
    scheme: "exact",
    network,
    maxAmountRequired: atomic,
    asset,
    payTo,
    resource: opts.resource,
    description: "SettleHop x402",
    mimeType: "application/json",
    outputSchema: null,
    maxTimeoutSeconds: 180,
    extra: { name: "USDC", version: "2" },
  };
  if (!opts.paymentHeader) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "Payment Required",
        x402Version: 1,
        accepts: [reqs],
        rail: "x402",
      },
    };
  }
  let payment: unknown = opts.paymentHeader;
  try {
    payment = JSON.parse(opts.paymentHeader);
  } catch {
    try {
      payment = JSON.parse(Buffer.from(opts.paymentHeader, "base64").toString("utf8"));
    } catch {
      return { ok: false, status: 400, body: { error: "bad_x402_header" } };
    }
  }
  const post = async (path: string) => {
    const res = await fetch(`${facilitator}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: payment,
        paymentRequirements: reqs,
      }),
    });
    return res.json().catch(() => ({ isValid: false, success: false }));
  };
  const verified = await post("/verify");
  if (!verified?.isValid) {
    return { ok: false, status: 402, body: { error: "reject.funds", rail: "x402", verified } };
  }
  const settled = await post("/settle");
  if (!settled?.success) {
    return { ok: false, status: 402, body: { error: "reject.funds", rail: "x402", settled } };
  }
  return { ok: true, status: 200, body: { rail: "x402", settled } };
}
