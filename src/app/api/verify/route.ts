import { NextRequest, NextResponse } from "next/server";
import { findSubscriptionByMerchantKey } from "@/lib/stripe";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

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

    return NextResponse.json(
      { valid, status: subscription?.status ?? null },
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
