import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";
import { resolveTollPayer, isTollPayerOk } from "@/lib/toll-billing";
import { checkCheckoutLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Toll balance top-up — the funding rail for Gates 3 (escrow) and 6 (bonds).
 *
 * An agent holding only a toll `ar_` API key previously had no way to fund
 * its toll_mock_balances: POST /api/credits/purchase requires a rider JWT,
 * and Ship funded test agents by hand. This endpoint closes that hole.
 *
 * POST /api/toll/balance/topup { amount_usd_cents } with toll billing auth
 * (Authorization: Bearer ar_… or X-Merchant-Key) → Stripe Checkout Session
 * (one-time payment). The Stripe webhook (checkout.session.completed,
 * metadata.gate = "toll_balance_topup") credits toll_mock_balances.
 *
 * 1 USD = 1,000,000 micro-USDC. No flag: this is the funding rail for
 * already-live gates, not a new toll.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

const MIN_USD_CENTS = 100; // $1
const MAX_USD_CENTS = 50000; // $500
const UUSDC_PER_USD_CENT = 10_000; // 1 USD = 1,000,000 uusdc

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(
      {
        ...payer.body,
        topup_hint: "funding this balance is exactly what /api/toll/balance/topup is for — but it needs the same auth",
      },
      { status: payer.status, headers: CORS_HEADERS }
    );
  }

  const rl = await checkCheckoutLimit(getClientIp(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { ...CORS_HEADERS, "retry-after": String(rl.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const usdCents = Math.round(Number(body?.amount_usd_cents));
  if (!Number.isFinite(usdCents) || usdCents < MIN_USD_CENTS || usdCents > MAX_USD_CENTS) {
    return NextResponse.json(
      {
        error: "invalid_amount",
        min_usd_cents: MIN_USD_CENTS,
        max_usd_cents: MAX_USD_CENTS,
        hint: "POST { amount_usd_cents } between 100 ($1) and 50000 ($500).",
        schema_url: "/api/toll/schema",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const uusdc = usdCents * UUSDC_PER_USD_CENT;
  // The agent being funded: ar_key payers fund themselves; merchant payers
  // may pass agent_id to fund a specific agent.
  let agentId = payer.kind === "ar_key" ? payer.agent_id : "";
  if (payer.kind === "merchant" && typeof body?.agent_id === "string" && body.agent_id.trim()) {
    agentId = body.agent_id.trim().slice(0, 128);
  }
  if (!agentId) {
    return NextResponse.json(
      {
        error: "missing_agent_id",
        hint: "merchants must pass { agent_id } to choose which agent gets funded; ar_ keys fund themselves.",
        schema_url: "/api/toll/schema",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const origin = req.headers.get("origin") || SITE_URL;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: usdCents,
            product_data: { name: `Toll balance top-up — ${uusdc.toLocaleString()} mock USDC` },
          },
          quantity: 1,
        },
      ],
      metadata: {
        gate: "toll_balance_topup",
        agent_id: agentId,
        payer_id: payer.payer_id,
        uusdc: String(uusdc),
      },
      success_url: `${origin}/?topup=done`,
      cancel_url: `${origin}/?topup=cancelled`,
    });

    return NextResponse.json(
      {
        url: session.url,
        live: true,
        agent_id: agentId,
        amount_usd_cents: usdCents,
        uusdc_credited_on_payment: uusdc,
        note: "mock USDC for toll escrow/bonds — credited when checkout completes; no chain IO",
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("toll balance topup checkout error", msg);
    return NextResponse.json(
      { error: "topup_checkout_failed", live: true, detail: msg.slice(0, 200) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
