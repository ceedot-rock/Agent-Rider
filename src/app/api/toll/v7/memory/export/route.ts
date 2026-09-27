import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll7MemoryTransfer } from "@/lib/stripe";
import { isToll7MemoryLive, TOLL7_MEMORY_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload, tollEnvelopeId } from "@/lib/toll-receipt";
import {
  TRANSFER_FEE_UUSDC,
  blobHashFor,
  buildExportPayload,
  buildTransferReceiptPayload,
  utcNow,
  validateExportPayload,
  validateMemories,
} from "@/lib/toll-7-core.mjs";

/**
 * Toll 7 — portable memory: signed export + hosted transfer.
 * Flag TOLL7_MEMORY_LIVE default OFF → 503 toll7_memory_off.
 *
 * POST body: { agent_id (non-empty string), memories (list of dicts),
 *              weights_ref?, to_host (non-empty string, required) }
 * Export is free and verifiable offline. The hosted transfer is metered
 * 2¢ (20_000 micro-USDC) per transfer to the subject agent — metered only,
 * no real charge (toll_meter row; Stripe reporter no-ops until env wired).
 * Blobs persist in toll_memory_transfers.envelope_json, content-addressed
 * by blob_hash — no filesystem writes in this route.
 */

const PRICE_USD = 0.02;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function bad(msg: string, hint?: string) {
  return NextResponse.json(
    { error: msg, ...(hint ? { hint } : {}) },
    { status: 400, headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  if (!isToll7MemoryLive()) {
    return NextResponse.json(TOLL7_MEMORY_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const agent_id = body.agent_id;
  const memories = body.memories;
  const to_host = body.to_host;

  // Fail closed on bad input: agent_id and to_host are required non-empty
  // strings; memories must validate as a list of string-keyed dicts.
  if (!agent_id || typeof agent_id !== "string")
    return bad("invalid_agent_id", "agent_id must be a non-empty string");
  if (!to_host || typeof to_host !== "string")
    return bad("invalid_to_host", "to_host must be a non-empty string");
  try {
    validateMemories(memories);
  } catch (err) {
    return bad("invalid_memories", (err as Error).message);
  }
  const weights_ref = body.weights_ref === undefined ? null : body.weights_ref;

  const usage = await checkMonthlyUsage(`toll7_export:${payer.payer_id}`, 0);
  if (usage.overLimit && payer.stripe_customer_id) {
    // Fail-open no-op until STRIPE_TOLL7_MEMORY_TRANSFER_METER_NAME is wired.
    await reportToll7MemoryTransfer(payer.stripe_customer_id);
  }

  // Build the signed portable export envelope (lab ES256 key).
  let payload: Record<string, unknown>;
  try {
    payload = buildExportPayload({
      agent_id,
      memories,
      weights_ref,
      exported_at: utcNow(),
    });
  } catch (err) {
    return bad("invalid_export", (err as Error).message);
  }
  let envelope;
  try {
    envelope = signTollPayload(payload);
  } catch (err) {
    console.error("toll7 export signing failed", (err as Error).message);
    return NextResponse.json(
      { error: "signing_unavailable" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  try {
    // Post-sign schema gate: same checks an offline consumer runs.
    validateExportPayload(envelope.payload);
  } catch (err) {
    return NextResponse.json(
      { error: "export_schema_violation", detail: (err as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const blob_hash = blobHashFor(envelope);
  const envelope_id = tollEnvelopeId(envelope);

  const receiptPayload = buildTransferReceiptPayload({
    blob_hash,
    from_agent: agent_id,
    to_host,
    envelope_id,
    transferred_at: utcNow(),
  });
  const receipt = signTollPayload(receiptPayload);

  // State write: content-addressed blob row. ON CONFLICT DO NOTHING keeps
  // re-transfers idempotent — fail closed on DB error (no silent drop).
  const db = getDB();
  const { error: stateErr } = await db.from("toll_memory_transfers").upsert(
    {
      blob_hash,
      from_agent: agent_id,
      to_host,
      receipt_json: receipt,
      envelope_json: envelope,
      created_at: new Date().toISOString(),
    },
    { onConflict: "blob_hash", ignoreDuplicates: true }
  );
  if (stateErr) {
    console.error("toll7 state write failed", stateErr.message);
    return NextResponse.json(
      { error: "state_write_failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Meter: 2¢ (20_000 micro-USDC) per transfer to from_agent — fail open.
  try {
    const { error: meterErr } = await db.from("toll_meter").insert({
      module: "memory",
      operation: "transfer",
      amount_uusdc: TRANSFER_FEE_UUSDC,
      ref_id: blob_hash,
      created_at: Math.floor(Date.now() / 1000),
    });
    if (meterErr) throw new Error(meterErr.message);
  } catch (err) {
    console.error("toll7 meter write failed (fail-open)", (err as Error).message);
  }

  const receipt_id = `t7_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_USD,
      receipt_id,
      blob_hash,
      envelope,
      receipt,
      usage: {
        callsThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: usage.overLimit && Boolean(payer.stripe_customer_id),
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
