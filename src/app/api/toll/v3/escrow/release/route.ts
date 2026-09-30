import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll3Escrow } from "@/lib/stripe";
import { isToll3EscrowLive, TOLL3_ESCROW_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { labJwks, signTollPayload, TollReceiptError, verifyTollEnvelope } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  BASE_CHAIN_ID,
  BASE_USDC,
  assertBaseAddress,
  TollSettleError,
  tollSend,
} from "@/lib/toll-settle";
import {
  buildEscrowReleasedPayload,
  Toll3Error,
  validateRelease,
} from "@/lib/toll-3-core.mjs";

/**
 * Toll 3 — escrow release. REAL USDC settlement on Base.
 *
 * On a valid lab-sealed delivery receipt the escrow wallet sends 99% of the
 * locked amount to the agent's payout wallet and 1% to the lab fee wallet —
 * two real Base USDC transfers via AwLPay, both idempotent.
 *
 * Safety rules:
 * - Escrows locked before real settlement (no deposit_tx_hash) can NEVER
 *   release real money → 409 escrow_predates_real_settlement.
 * - locked → releasing → released, each flip conditional. A retry on a row
 *   stuck in "releasing" reuses the same idempotency keys, so AwLPay never
 *   double-sends; recovery is crash-safe.
 * - TOLL_FEE_WALLET must be set, or the release fails closed (the 1% must
 *   land somewhere real, never stranded).
 *
 * Flag TOLL3_ESCROW_LIVE default OFF → 503.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isToll3EscrowLive()) {
    return NextResponse.json(TOLL3_ESCROW_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const escrow_id = body.escrow_id;
  const envelope = body.delivery_receipt_envelope;
  if (!Number.isInteger(escrow_id) || escrow_id <= 0) {
    return NextResponse.json({ error: "bad_escrow_id" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!envelope || typeof envelope !== "object") {
    return NextResponse.json({ error: "bad_delivery_receipt" }, { status: 400, headers: CORS_HEADERS });
  }

  // Fail closed on receipt verification: unknown kid / bad sig / malformed → 400 with reason.
  let receipt;
  try {
    receipt = verifyTollEnvelope(envelope, labJwks());
  } catch (err) {
    const reason = err instanceof TollReceiptError ? err.message : "verifier unavailable";
    return NextResponse.json(
      { error: "bad_delivery_receipt", reason },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let feeWallet: string;
  try {
    feeWallet = assertBaseAddress(process.env.TOLL_FEE_WALLET, "TOLL_FEE_WALLET");
  } catch (err) {
    console.error("toll3 release: fee wallet unconfigured");
    return NextResponse.json(
      { error: "toll_fee_wallet_unconfigured", reason: (err as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let db;
  try {
    db = getDB();
  } catch (err) {
    console.error("toll3 release: toll store unavailable", (err as Error).message);
    return NextResponse.json({ error: "toll_store_unavailable" }, { status: 500, headers: CORS_HEADERS });
  }

  const escRow = await db.from("toll_escrows").select("*").eq("id", escrow_id).single();
  if (escRow.error || !escRow.data) {
    return NextResponse.json({ error: "unknown_escrow", escrow_id }, { status: 404, headers: CORS_HEADERS });
  }
  const row = escRow.data;

  // Mock-era escrows never received real deposits — real money must never
  // move against them.
  if (!row.deposit_tx_hash) {
    return NextResponse.json(
      { error: "escrow_predates_real_settlement", reason: "this escrow was locked before real USDC settlement; it cannot release real funds" },
      { status: 409, headers: CORS_HEADERS }
    );
  }
  let payoutWallet: string;
  try {
    payoutWallet = assertBaseAddress(row.payout_wallet, "payout_wallet");
  } catch {
    return NextResponse.json(
      { error: "escrow_payout_unconfigured", reason: "escrow has no payout wallet on file" },
      { status: 409, headers: CORS_HEADERS }
    );
  }

  const escrowRow = {
    id: row.id,
    job_id: row.job_id,
    payer: row.payer,
    agent_id: row.agent_id,
    amount_uusdc: Number(row.amount_uusdc),
    fee_uusdc: Number(row.fee_uusdc),
    // Recovery: a row stuck in "releasing" after a crash re-enters here;
    // validate against "locked" semantics, the receipt is still checked.
    status: row.status === "releasing" ? "locked" : row.status,
  };

  // Fail closed on release validation: 402 with reason (payment-state refusal).
  let net_uusdc: number;
  try {
    ({ net: net_uusdc } = validateRelease(escrowRow, receipt));
  } catch (err) {
    if (err instanceof Toll3Error) {
      return NextResponse.json(
        { error: "release_refused", reason: err.message },
        { status: 402, headers: CORS_HEADERS }
      );
    }
    throw err;
  }
  const fee_uusdc = escrowRow.amount_uusdc - net_uusdc;

  // Single-flight guard: only one release attempt proceeds past "locked".
  if (row.status === "locked") {
    const flip = await db
      .from("toll_escrows")
      .update({ status: "releasing" })
      .eq("id", escrow_id)
      .eq("status", "locked");
    if (flip.error) {
      console.error("toll3 release: releasing flip failed", flip.error.message);
      return NextResponse.json({ error: "toll_store_unavailable" }, { status: 500, headers: CORS_HEADERS });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  // Real money movement. Idempotency keys are deterministic per escrow, so
  // a crash between the two sends (or a client retry) can never double-pay.
  let releaseTx: string;
  let feeTx: string;
  try {
    ({ tx_hash: releaseTx } = await tollSend({
      slot: "escrow",
      to_address: payoutWallet,
      amount_uusdc: net_uusdc,
      idempotency_key: `t3:release:${escrow_id}`,
      purpose: "escrow_release",
    }));
    ({ tx_hash: feeTx } = await tollSend({
      slot: "escrow",
      to_address: feeWallet,
      amount_uusdc: fee_uusdc,
      idempotency_key: `t3:fee:${escrow_id}`,
      purpose: "escrow_fee",
    }));
  } catch (err) {
    const status = err instanceof TollSettleError ? err.status : 502;
    console.error("toll3 release: toll send failed", (err as Error).message);
    return NextResponse.json(
      { error: "release_send_failed", reason: (err as Error).message },
      { status, headers: CORS_HEADERS }
    );
  }

  // Append-only chain transfer log — fail open; the chain tx is the truth.
  try {
    await db.from("toll_chain_transfers").insert([
      { kind: "release", ref_id: String(escrow_id), tx_hash: releaseTx, from_slot: "escrow", to_wallet: payoutWallet, amount_uusdc: net_uusdc, idempotency_key: `t3:release:${escrow_id}`, created_at: now },
      { kind: "fee", ref_id: String(escrow_id), tx_hash: feeTx, from_slot: "escrow", to_wallet: feeWallet, amount_uusdc: fee_uusdc, idempotency_key: `t3:fee:${escrow_id}`, created_at: now },
    ]);
  } catch (err) {
    console.error("toll3 release: chain-transfer log failed (fail-open)", (err as Error).message);
  }

  const statusUpdate = await db
    .from("toll_escrows")
    .update({ status: "released", settled_at: now, release_tx_hash: releaseTx, fee_tx_hash: feeTx })
    .eq("id", escrow_id)
    .eq("status", "releasing"); // double-release guard
  if (statusUpdate.error) {
    console.error("toll3 release: status update failed", statusUpdate.error.message);
    return NextResponse.json({ error: "toll_store_unavailable" }, { status: 500, headers: CORS_HEADERS });
  }

  const usage = await checkMonthlyUsage(`toll3_release:${payer.payer_id}`, 0);
  let billed = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll3Escrow(payer.stripe_customer_id);
    billed = true;
  }

  const released = signTollPayload(
    buildEscrowReleasedPayload({
      escrow_id,
      job_id: escrowRow.job_id,
      agent_id: escrowRow.agent_id,
      net_uusdc,
      created_at: now,
    })
  );
  const receipt_id = `t3_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: null,
      receipt_id,
      escrow_id,
      release_tx: releaseTx,
      fee_tx: feeTx,
      net_uusdc,
      fee_uusdc,
      chain_id: BASE_CHAIN_ID,
      token_contract: BASE_USDC,
      envelope: released,
      usage: { releasesThisMonth: usage.count, overLimit: usage.overLimit, billed },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
