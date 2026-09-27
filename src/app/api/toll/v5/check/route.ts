import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll5Check } from "@/lib/stripe";
import { isToll5CheckLive, TOLL5_CHECK_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  CHECK_TOLL_UUSDC,
  OracleError,
  artifactHashOf,
  buildAttestationPayload,
  defaultExactness,
  validateCheckResult,
} from "@/lib/toll-5-core.mjs";

/**
 * Toll 5 — verification oracle / exactness attestations (10¢ per check).
 * POST /api/toll/v5/check { artifact: dict, claim: { stdout: string, ... } }
 * → sealed exactness attestation envelope, stored + metered.
 * Flag TOLL5_CHECK_LIVE default OFF → 503 toll5_check_off (no state).
 * Metered only — no real charge. Stripe reporters stay no-op until env wired.
 */

const PRICE_USD = 0.1;

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
  if (!isToll5CheckLive()) {
    return NextResponse.json(TOLL5_CHECK_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  // Fail closed on malformed input: artifact must be a dict, claim must be
  // a dict with a string stdout. OracleError → 400; a "refuse" result is a
  // successful check with a negative outcome, never an error.
  const body = await req.json().catch(() => null);
  let checkResult;
  try {
    // PLUG-IN POINT: the real CuNi exactness gate plugs in here, replacing
    // defaultExactness. It must honor the exactness-fn interface:
    //   (artifact: dict, claim: dict) -> { result: "pass"|"refuse",
    //                                      seats: [...], detail: {...} }
    // and its output still passes through validateCheckResult() below.
    checkResult = validateCheckResult(
      defaultExactness(body?.artifact, body?.claim)
    );
  } catch (err) {
    if (err instanceof OracleError)
      return bad(400, "malformed_check_request", { reason: (err as Error).message });
    throw err;
  }

  const usage = await checkMonthlyUsage(`toll5_check:${payer.payer_id}`, 0);
  let metered = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll5Check(payer.stripe_customer_id);
    metered = true;
  } else if (usage.overLimit && !payer.stripe_customer_id) {
    // ar_ payer without Stripe customer — still check; overage logged but not billed yet.
    metered = true;
    console.warn(
      "toll5 check overage without stripe_customer_id",
      payer.payer_id,
      "set TOLL5_CHECK_METER_NAME + link customer when ready"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const artifact = body.artifact;
  const claim = body.claim;
  const { attestation_id, payload } = buildAttestationPayload({
    artifact,
    claim,
    checkResult,
    checked_at: now,
  });
  const artifact_hash = artifactHashOf(artifact);
  // Lab-sealed envelope; throws (500) without RIDER_PRIVATE_KEY — fail closed.
  const envelope = signTollPayload(payload);

  // DB writes fail closed: no attestation leaves the route unrecorded.
  let db;
  try {
    db = getDB();
  } catch (err) {
    console.error("toll5 check: toll store unavailable", (err as Error).message);
    return bad(500, "toll_store_unavailable");
  }

  const attRow = await db.from("toll_attestations").insert({
    attestation_id,
    artifact_hash,
    envelope_json: envelope,
    result: checkResult.result,
    checked_at: now,
  });
  if (attRow.error) {
    console.error("toll5 check: attestation row write failed", attRow.error.message);
    return bad(500, "attestation_store_failed");
  }

  // Meter the 10¢ check — fail open, never blocks the check.
  try {
    const meterRow = await db.from("toll_meter").insert({
      module: "oracle",
      operation: "check",
      amount_uusdc: CHECK_TOLL_UUSDC,
      ref_id: attestation_id,
      created_at: now,
    });
    if (meterRow.error)
      console.error("toll5 check: toll_meter write failed", meterRow.error.message);
  } catch (err) {
    console.error("toll5 check: toll_meter write failed (fail-open)", (err as Error).message);
  }

  const receipt_id = `t5_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_USD,
      receipt_id,
      attestation_id,
      artifact_hash,
      result: checkResult.result,
      envelope,
      usage: {
        checksThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: metered && Boolean(payer.stripe_customer_id),
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
