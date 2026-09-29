import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";
import { isToll2PromoteLive, TOLL2_PROMOTE_OFF_BODY } from "@/lib/toll-flags";
import { checkCheckoutLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Toll 2 promote — Stripe $9/mo per capability.
 * Flag TOLL2_PROMOTE_LIVE default OFF → 503 stub (no charge, no subscription create).
 * When ON: creates a Checkout Session for STRIPE_CAPABILITY_PROMOTE_PRICE_ID
 * ($9/mo recurring). The Stripe webhook (checkout.session.completed) marks the
 * capability promoted via its placement { promoted, promoted_until }.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isToll2PromoteLive()) {
    return NextResponse.json(
      {
        ...TOLL2_PROMOTE_OFF_BODY,
        shape_when_live: {
          body: { capability_id: "cap_…", email: "optional@example.com" },
          auth: "Authorization: Bearer <redacted>… or X-Merchant-Key",
          env: ["STRIPE_CAPABILITY_PROMOTE_PRICE_ID", "TOLL2_PROMOTE_LIVE"],
        },
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  const priceId = (process.env.STRIPE_CAPABILITY_PROMOTE_PRICE_ID ?? "").trim();
  if (!priceId) {
    return NextResponse.json(
      {
        error: "toll2_promote_price_missing",
        live: false,
        hint: "TOLL2_PROMOTE_LIVE is on but STRIPE_CAPABILITY_PROMOTE_PRICE_ID is not set. Set it to the $9/mo recurring Stripe price id.",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const rl = await checkCheckoutLimit(getClientIp(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { ...CORS_HEADERS, "retry-after": String(rl.retryAfter) } }
    );
  }

  let capabilityId = "";
  let email: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.capability_id === "string") capabilityId = body.capability_id.trim();
    if (typeof body?.email === "string" && EMAIL_RE.test(body.email)) email = body.email;
  } catch {
    // no body — capability_id check below will 400 honestly
  }

  if (!capabilityId) {
    return NextResponse.json(
      {
        error: "missing_capability_id",
        live: true,
        hint: "POST { capability_id } to promote a capability listing for $9/mo.",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const origin = req.headers.get("origin") || SITE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { gate: "toll2_promote", capability_id: capabilityId },
      subscription_data: {
        metadata: { gate: "toll2_promote", capability_id: capabilityId },
      },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      customer_email: email,
    });

    return NextResponse.json(
      {
        url: session.url,
        live: true,
        price_usd_mo: 9,
        capability_id: capabilityId,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("toll2 promote checkout error", msg);
    return NextResponse.json(
      { error: "promote_checkout_failed", live: true, detail: msg.slice(0, 200) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
