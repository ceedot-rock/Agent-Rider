import { NextRequest, NextResponse } from "next/server";
import { verifyRider } from "@/lib/rider";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportRiderVerifyOverage } from "@/lib/stripe";
import { isToll1MeterLive, TOLL1_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxV1 } from "@/lib/toll-sandbox";

/**
 * Toll 1 — metered rider-JWT verify (0.5¢ after 100 free/mo per ar_ key).
 * Flag TOLL1_METER_LIVE default OFF → 503 toll1_meter_off (no charge).
 * Free forever: POST /api/rider/verify and GET /.well-known/jwks.json.
 */

const FREE_CALLS_PER_MONTH = Number(process.env.TOLL1_VERIFY_FREE_CALLS_PER_MONTH ?? 100);
const PRICE_USD = 0.005;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isToll1MeterLive()) {
    return NextResponse.json(TOLL1_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  // Corruption sandbox: the public demo key runs the full validation
  // pipeline with zero side effects. It can never authorize real dispatch.
  if (isSandboxRequest(req)) {
    return sandboxV1(req);
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const token = body.rider ?? req.headers.get("x-agent-rider");
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "missing_rider" }, { status: 400, headers: CORS_HEADERS });
  }

  const usage = await checkMonthlyUsage(`toll1_verify:${payer.payer_id}`, FREE_CALLS_PER_MONTH);
  let metered = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportRiderVerifyOverage(payer.stripe_customer_id);
    metered = true;
  } else if (usage.overLimit && !payer.stripe_customer_id) {
    // ar_ payer without Stripe customer — still verify; overage logged but not billed yet.
    metered = true;
    console.warn(
      "toll1 verify overage without stripe_customer_id",
      payer.payer_id,
      "set STRIPE_RIDER_VERIFY_METER_NAME + link customer when ready"
    );
  }

  const result = await verifyRider(token);
  const receipt_id = `tv1_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      ...result,
      metered: true,
      live: true,
      price_usd: PRICE_USD,
      receipt_id,
      usage: {
        callsThisMonth: usage.count,
        freeLimit: FREE_CALLS_PER_MONTH,
        overage: usage.overLimit,
        billed: metered && Boolean(payer.stripe_customer_id),
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
