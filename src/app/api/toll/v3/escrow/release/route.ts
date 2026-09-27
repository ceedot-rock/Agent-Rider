import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll3Escrow } from "@/lib/stripe";
import { isToll3EscrowLive, TOLL3_ESCROW_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { labJwks, signTollPayload, TollReceiptError, verifyTollEnvelope } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  buildEscrowReleasedPayload,
  escrowAcct,
  mockTxHash,
  Toll3Error,
  validateRelease,
} from "@/lib/toll-3-core.mjs";

/**
 * Toll 3 — escrow release. Releases locked funds to the agent on a valid
 * lab-sealed delivery receipt (type "delivery_receipt", delivered_ok true,
 * matching job_id + agent_id). Flag TOLL3_ESCROW_LIVE default OFF → 503.
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
  const escrowRow = {
    id: row.id,
    job_id: row.job_id,
    payer: row.payer,
    agent_id: row.agent_id,
    amount_uusdc: Number(row.amount_uusdc),
    fee_uusdc: Number(row.fee_uusdc),
    status: row.status,
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

  const now = Math.floor(Date.now() / 1000);
  const release_tx = mockTxHash(
    escrowAcct(escrow_id),
    escrowRow.agent_id,
    net_uusdc,
    `escrow release job ${escrowRow.job_id}`,
    now,
    crypto.randomUUID()
  );

  const ledgerInsert = await db.from("toll_mock_ledger").insert({
    tx_hash: release_tx,
    sender: escrowAcct(escrow_id),
    recipient: escrowRow.agent_id,
    amount_uusdc: net_uusdc,
    memo: `escrow release job ${escrowRow.job_id}`,
    created_at: now,
  });
  if (ledgerInsert.error) {
    console.error("toll3 release: ledger insert failed", ledgerInsert.error.message);
    return NextResponse.json({ error: "toll_store_unavailable" }, { status: 500, headers: CORS_HEADERS });
  }
  const statusUpdate = await db
    .from("toll_escrows")
    .update({ status: "released", settled_at: now })
    .eq("id", escrow_id)
    .eq("status", "locked"); // double-release guard: only flips from locked
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
      release_tx,
      net_uusdc,
      envelope: released,
      usage: { releasesThisMonth: usage.count, overLimit: usage.overLimit, billed },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
