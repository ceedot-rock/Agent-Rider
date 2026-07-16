import { NextRequest, NextResponse } from "next/server";
import { findSubscriptionByMerchantKey, reportVerifyOverage } from "@/lib/stripe";
import { checkMonthlyUsage } from "@/lib/rate-limit";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// Rider issuance itself is free; this is the one thing merchants actually
// pay for. First VERIFY_FREE_CALLS_PER_MONTH calls per merchant per
// calendar month are included in the Merchant Gate subscription, calls
// above that still succeed (verification is a merchant's compliance/fraud
// surface — degrading it to save them a few cents would be the wrong
// failure mode) but get reported as billable overage via Stripe's Billing
// Meters API, see reportVerifyOverage().
const FREE_CALLS_PER_MONTH = Number(process.env.VERIFY_FREE_CALLS_PER_MONTH ?? 69);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let merchantKey: string | undefined;
  try {
    const body = await req.json();
    merchantKey = body?.merchantKey;
  } catch {
    // fall through — handled by the missing-key check below
  }

  if (!merchantKey) {
    return NextResponse.json(
      { valid: false, error: "merchantKey required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const subscription = await findSubscriptionByMerchantKey(merchantKey);
    const valid = !!subscription && ACTIVE_STATUSES.has(subscription.status);

    if (!valid) {
      return NextResponse.json(
        { valid, status: subscription?.status ?? null },
        { headers: CORS_HEADERS }
      );
    }

    const usage = await checkMonthlyUsage(`verify:${merchantKey}`, FREE_CALLS_PER_MONTH);
    if (usage.overLimit) {
      const customerId =
        typeof subscription!.customer === "string" ? subscription!.customer : subscription!.customer.id;
      await reportVerifyOverage(customerId);
    }

    return NextResponse.json(
      {
        valid,
        status: subscription?.status ?? null,
        usage: { callsThisMonth: usage.count, freeLimit: FREE_CALLS_PER_MONTH, overage: usage.overLimit },
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error("verify error", err);
    return NextResponse.json(
      { valid: false, error: "Verification failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
