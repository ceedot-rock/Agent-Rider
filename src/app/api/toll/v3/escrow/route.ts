import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll3Escrow } from "@/lib/stripe";
import { isToll3EscrowLive, TOLL3_ESCROW_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  buildEscrowLockPayload,
  escrowAcct,
  escrowFeeFor,
  LAB_FEES_ACCT,
  mockTxHash,
  Toll3Error,
  validateAmountUusdc,
} from "@/lib/toll-3-core.mjs";

/**
 * Toll 3 — escrow lock. Payer locks integer micro-USDC against a job-spec
 * hash; a 1% routing fee is accounted to lab:fees at lock time.
 * Flag TOLL3_ESCROW_LIVE default OFF → 503 toll3_escrow_off (no state).
 * Mocked settlement only — fake USDC, zero chain IO, no real money.
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
      lock_tx: "",
      created_at: now,
      timeout_at: now + timeout_sec,
    })
    .select("id")
    .single();
  if (insertEscrow.error || !insertEscrow.data) {
    console.error("toll3 escrow: insert failed", insertEscrow.error?.message);
    return bad(500, "toll_store_unavailable");
  }
  const escrow_id = insertEscrow.data.id as number;

  const nonce = crypto.randomUUID();
  const lock_tx = mockTxHash(payer.payer_id, escrowAcct(escrow_id), amount_uusdc, `escrow lock job ${job_id}`, now, nonce);
  const fee_tx = mockTxHash(escrowAcct(escrow_id), LAB_FEES_ACCT, lock.fee_uusdc, `1% routing fee job ${job_id}`, now, `${nonce}:fee`);

  const ledgerRows = [
    { tx_hash: lock_tx, sender: payer.payer_id, recipient: escrowAcct(escrow_id), amount_uusdc, memo: `escrow lock job ${job_id}`, created_at: now },
    { tx_hash: fee_tx, sender: escrowAcct(escrow_id), recipient: LAB_FEES_ACCT, amount_uusdc: lock.fee_uusdc, memo: `1% routing fee job ${job_id}`, created_at: now },
  ];
  const ledgerInsert = await db.from("toll_mock_ledger").insert(ledgerRows);
  if (ledgerInsert.error) {
    console.error("toll3 escrow: ledger insert failed", ledgerInsert.error.message);
    return bad(500, "toll_store_unavailable");
  }
  const lockTxUpdate = await db.from("toll_escrows").update({ lock_tx }).eq("id", escrow_id);
  if (lockTxUpdate.error) {
    console.error("toll3 escrow: lock_tx update failed", lockTxUpdate.error.message);
    return bad(500, "toll_store_unavailable");
  }

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
    lock_tx,
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
      lock_tx,
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
