import { NextRequest, NextResponse } from "next/server";
import { retrieveSession, updateSubscriptionMetadata } from "@/lib/stripe";
import { generateMerchantKey } from "@/lib/merchant-key";
import { checkProvisionLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const rl = await checkProvisionLimit(getClientIp(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  try {
    const session = await retrieveSession(sessionId);
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return NextResponse.json({ error: "Session not completed" }, { status: 402 });
    }

    const subscription = session.subscription;
    if (!subscription || typeof subscription === "string") {
      return NextResponse.json({ error: "No subscription on session" }, { status: 500 });
    }

    // The webhook may have already provisioned a key; reuse it instead of
    // handing out a second, disconnected one that Stripe has no record of.
    let merchantKey = subscription.metadata?.merchant_key;
    if (!merchantKey) {
      merchantKey = generateMerchantKey();
      await updateSubscriptionMetadata(subscription.id, { merchant_key: merchantKey });
    }

    return NextResponse.json({
      merchantKey,
      customerEmail: session.customer_details?.email ?? null,
      subscriptionId: subscription.id,
    });
  } catch (err: any) {
    console.error("provision error", err);
    return NextResponse.json({ error: err?.message || "Provisioning failed" }, { status: 500 });
  }
}
