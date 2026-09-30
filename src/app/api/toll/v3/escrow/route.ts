import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll3Escrow } from "@/lib/stripe";
import { isToll3EscrowLive, TOLL3_ESCROW_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  BASE_CHAIN_ID,
  BASE_USDC,
  assertBaseAddress,
  TollSettleError,
  verifyTollDeposit,
} from "@/lib/toll-settle";
import {
  buildEscrowLockPayload,
  Toll3Error,
  validateAmountUusdc,
} from "@/lib/toll-3-core.mjs";

/**
 * Toll 3 — escrow lock. REAL USDC settlement on Base.
 *
 * The payer sends `amount_uusdc` of native USDC (Base chain 8453) to the lab
 * escrow wallet, signs a deposit binding, and passes the deposit tx hash
 * here. Rider verifies the deposit on-chain through AwLPay BEFORE recording
 * the escrow — no deposit proof, no escrow. The 1% routing fee is realized
 * at release (99% to the agent, 1% to the lab fee wallet); a refund returns
 * the full amount with no fee.
 *
 * Flag TOLL3_ESCROW_LIVE default OFF → 503 toll3_escrow_off (no state).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isToll3EscrowLive()) {
    return NextResponse.json(TOLL3_ESCROW_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  // Fail closed on bad input: every field validated before any state changes.
  const body = await req.json().catch(() => ({}));
  const agent_id = body.agent_id;
  const job_id = body.job_id;
  const job_spec_hash = body.job_spec_hash;
  const timeout_sec = body.timeout_sec ?? 86400;
  if (typeof agent_id !== "string" || agent_id.length === 0) return bad(400, "bad_agent_id");
  if (typeof job_id !== "string" || job_id.length === 0) return bad(400, "bad_job_id");
  if (typeof job_spec_hash !== "string" || job_spec_hash.length === 0) return bad(400, "bad_job_spec_hash");
  if (!Number.isInteger(timeout_sec) || timeout_sec <= 0) return bad(400, "bad_timeout_sec");
  let amount_uusdc: number;
  try {
    amount_uusdc = validateAmountUusdc(body.amount_uusdc);
  } catch (err) {
    return bad(400, "bad_amount_uusdc", { reason: (err as Error).message });
  }
  // Real-settlement fields.
  const deposit_tx_hash = body.deposit_tx_hash;
  const payer_sig = body.payer_sig;
  if (typeof deposit_tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(deposit_tx_hash)) {
    return bad(400, "bad_deposit_tx_hash", { reason: "want 0x + 64 hex, the real Base USDC transfer into the escrow wallet" });
  }
  if (typeof payer_sig !== "string" || payer_sig.length === 0) {
    return bad(400, "bad_payer_sig", { reason: "EIP-191 personal signature binding this deposit to your ref" });
  }
  let payout_wallet: string;
  try {
    payout_wallet = assertBaseAddress(body.payout_wallet, "payout_wallet");
  } catch (err) {
    return bad(400, "bad_payout_wallet", { reason: (err as Error).message });
  }
  const sig_ref = typeof body.sig_ref === "string" && body.sig_ref.length > 0 ? body.sig_ref : job_id;

  const usage = await checkMonthlyUsage(`toll3_escrow:${payer.payer_id}`, 0);
  let metered = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll3Escrow(payer.stripe_customer_id);
    metered = true;
  }

  const now = Math.floor(Date.now() / 1000);
  let lock;
  try {
    lock = buildEscrowLockPayload({
      escrow_id: 0, // patched after insert
      payer: payer.payer_id,
      agent_id,
      job_id,
      amount_uusdc,
      job_spec_hash,
      timeout_sec,
      created_at: now,
    });
  } catch (err) {
    if (err instanceof Toll3Error) return bad(400, "bad_escrow_params", { reason: err.message });
    throw err;
  }
  // Mirror Python: a 0 fee transfer raises BillingError. Fail closed at the
  // input boundary instead of letting it hit the store.
  if (lock.fee_uusdc <= 0) {
    return bad(400, "bad_amount_uusdc", {
      reason: "amount too small: 1% routing fee rounds to zero (min 10000 uusdc = 1¢)",
    });
  }

  // Prove the real deposit BEFORE any state changes. No proof, no escrow.
  let proof;
  try {
    proof = await verifyTollDeposit({
      slot: "escrow",
      tx_hash: deposit_tx_hash,
      payer_sig,
      min_uusdc: amount_uusdc,
      ref: sig_ref,
    });
  } catch (err) {
    if (err instanceof TollSettleError) {
      return bad(err.status, "deposit_not_proven", { reason: err.message });
    }
    throw err;
  }

  // Money-state writes fail closed: any failure → 500, no envelope minted.
  let db;
  try {
    db = getDB();
  } catch (err) {
    console.error("toll3 escrow: toll store unavailable", (err as Error).message);
    return bad(500, "toll_store_unavailable");
  }

  const insertEscrow = await db
    .from("toll_escrows")
    .insert({
      job_id,
      payer: payer.payer_id,
      agent_id,
      amount_uusdc,
      fee_uusdc: lock.fee_uusdc,
      job_spec_hash,
      status: "locked",
      lock_tx: deposit_tx_hash,
      deposit_tx_hash,
      payer_wallet: proof.payer,
      payout_wallet,
      confirmed_uusdc: proof.paid_uusdc,
      chain_id: BASE_CHAIN_ID,
      token_contract: BASE_USDC,
      created_at: now,
      timeout_at: now + timeout_sec,
    })
    .select("id")
    .single();
  if (insertEscrow.error || !insertEscrow.data) {
    // A deposit funds exactly one escrow: a replayed tx hash is a 409,
    // never a second escrow.
    if (insertEscrow.error?.code === "23505") {
      return bad(409, "deposit_already_claimed", {
        reason: "this deposit tx hash already funds an escrow",
      });
    }
    console.error("toll3 escrow: insert failed", insertEscrow.error?.message);
    return bad(500, "toll_store_unavailable");
  }
  const escrow_id = insertEscrow.data.id as number;

  // Meter the 1% fee — fail open, never blocks the lock.
  try {
    await db.from("toll_meter").insert({
      module: "billing",
      operation: "escrow_lock",
      amount_uusdc: lock.fee_uusdc,
      ref_id: `escrow:${escrow_id}`,
      created_at: now,
    });
  } catch (err) {
    console.error("toll3 escrow: meter write failed (fail-open)", (err as Error).message);
  }

  const envelope = signTollPayload({
    ...lock.payload,
    escrow_id,
    timeout_at: now + timeout_sec,
    lock_tx: deposit_tx_hash,
    chain_id: BASE_CHAIN_ID,
    token_contract: BASE_USDC,
  });
  const receipt_id = `t3_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: null,
      fee_uusdc: lock.fee_uusdc,
      net_uusdc: lock.net_uusdc,
      receipt_id,
      escrow_id,
      lock_tx: deposit_tx_hash,
      deposit_tx_hash,
      payer_wallet: proof.payer,
      payout_wallet,
      confirmed_uusdc: proof.paid_uusdc,
      chain_id: BASE_CHAIN_ID,
      token_contract: BASE_USDC,
      envelope,
      usage: {
        locksThisMonth: usage.count,
        overLimit: usage.overLimit,
        billed: metered && Boolean(payer.stripe_customer_id),
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
