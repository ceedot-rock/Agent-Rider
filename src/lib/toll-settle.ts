/**
 * toll-settle.ts — Rider's client for AwLPay's real-USDC toll settlement.
 *
 * Gate 3 (escrow) and Gate 6 (bonds) settle in native USDC on Base
 * (chain 8453). AwLPay owns the keys and the broadcast law; Rider owns
 * the deal policy (who pays whom how much) and calls these two functions:
 *
 *   verifyTollDeposit(...) — read-only. Proves a payer's real on-chain
 *     USDC deposit into the escrow/bond wallet before Rider records it.
 *   tollSend(...) — MOVES REAL MONEY. Signs + broadcasts one USDC
 *     transfer from the slot wallet. Guarded by caps + idempotency.
 *
 * Config: AWLPAY_BASE_URL (default https://awlpay.fly.dev),
 * TOLL_SERVICE_SECRET (shared secret, server-only — never ship to client).
 */

const AWLPAY_BASE =
  process.env.AWLPAY_BASE_URL ?? "https://awlpay.fly.dev";
const SERVICE_SECRET = process.env.TOLL_SERVICE_SECRET ?? "";

export class TollSettleError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "TollSettleError";
    this.status = status;
  }
}

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type TollSlot = "escrow" | "bonds";

export interface DepositProof {
  verified: boolean;
  slot: TollSlot;
  tx_hash: string;
  payer: string;
  wallet: string;
  paid_uusdc: number;
  block_number: number;
  chain_id: number;
  token: string;
}

export interface TollSendResult {
  sent: boolean;
  slot: TollSlot;
  to_address: string;
  amount_uusdc: number;
  tx_hash: string;
  idempotent: boolean;
}

async function callAwlPay(path: string, body: unknown): Promise<Response> {
  if (!SERVICE_SECRET) {
    throw new TollSettleError(
      "toll settlement not configured (TOLL_SERVICE_SECRET missing)",
      500,
    );
  }
  let res: Response;
  try {
    res = await fetch(`${AWLPAY_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-toll-service-secret": SERVICE_SECRET,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new TollSettleError(
      `toll settlement unreachable: ${(e as Error).message}`,
      502,
    );
  }
  return res;
}

export type TollNetwork = "mainnet" | "sepolia";

/**
 * Verify a real USDC deposit into the slot wallet. Throws TollSettleError
 * when the deposit is not proven. The signer binds their deposit with an
 * EIP-191 personal signature over binding_message(tx_hash, slot, ref);
 * `ref` must match what the payer actually signed.
 *
 * network="sepolia" selects the Base Sepolia testnet path (test funds
 * only); the default is mainnet.
 */
export async function verifyTollDeposit(args: {
  slot: TollSlot;
  tx_hash: string;
  payer_sig: string;
  min_uusdc: number;
  ref: string;
  network?: TollNetwork;
}): Promise<DepositProof> {
  const res = await callAwlPay("/internal/toll/deposit/verify", args);
  const data = (await res.json()) as DepositProof & { reason?: string };
  if (!res.ok || !data.verified) {
    throw new TollSettleError(
      `deposit not proven: ${data.reason ?? "unknown"}`,
      res.status === 403 ? 402 : 502,
    );
  }
  if (data.chain_id !== BASE_CHAIN_ID || data.token !== BASE_USDC) {
    throw new TollSettleError("deposit is not canonical Base USDC", 502);
  }
  return data;
}

/**
 * Send real USDC from the slot wallet. MOVES REAL MONEY.
 * Idempotency: the same idempotency_key never sends twice — a retry
 * returns the original tx hash.
 *
 * network="sepolia" selects the Base Sepolia testnet path (test funds
 * only); the default is mainnet.
 */
export async function tollSend(args: {
  slot: TollSlot;
  to_address: string;
  amount_uusdc: number;
  idempotency_key: string;
  purpose: string;
  network?: TollNetwork;
}): Promise<TollSendResult> {
  const res = await callAwlPay("/internal/toll/send", args);
  const data = (await res.json()) as TollSendResult & { reason?: string };
  if (!res.ok || !data.sent) {
    throw new TollSettleError(
      `toll send failed: ${data.reason ?? "unknown"}`,
      res.status,
    );
  }
  return data;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Fail-fast guard for any wallet address Rider accepts from callers. */
export function assertBaseAddress(value: unknown, name: string): string {
  if (typeof value !== "string" || !ADDR_RE.test(value)) {
    throw new TollSettleError(
      `${name} must be a 0x Base address`,
      400,
    );
  }
  return value;
}
