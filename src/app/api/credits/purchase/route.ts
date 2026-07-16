import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { createCreditsCheckoutSession } from "@/lib/stripe";
import { checkCreditsPurchaseLimit } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { MIN_PURCHASE_USD_CENTS, MAX_PURCHASE_USD_CENTS, usdCentsToCredits } from "@/lib/credits";

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "credits:purchase");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const rl = await checkCreditsPurchaseLimit(gate.rider.agent_id);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const usdCents = Math.round(Number(body.usdCents));
  if (!Number.isFinite(usdCents) || usdCents < MIN_PURCHASE_USD_CENTS || usdCents > MAX_PURCHASE_USD_CENTS) {
    return NextResponse.json(
      { error: "invalid_amount", min_usd_cents: MIN_PURCHASE_USD_CENTS, max_usd_cents: MAX_PURCHASE_USD_CENTS },
      { status: 400 }
    );
  }

  const credits = usdCentsToCredits(usdCents);
  const origin = req.headers.get("origin") || SITE_URL;

  try {
    const session = await createCreditsCheckoutSession({
      participantId: gate.rider.agent_id,
      credits,
      usdCents,
      successUrl: `${origin}/?credits=purchased`,
      cancelUrl: `${origin}/?credits=cancelled`,
    });
    return NextResponse.json({ url: session.url, credits, usdCents });
  } catch (err: any) {
    console.error("credits purchase checkout error", err);
    return NextResponse.json({ error: err?.message || "checkout_failed" }, { status: 500 });
  }
}
