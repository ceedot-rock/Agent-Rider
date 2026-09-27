import { NextRequest, NextResponse } from "next/server";
import { isToll2PromoteLive, TOLL2_PROMOTE_OFF_BODY } from "@/lib/toll-flags";

/**
 * Toll 2 promote — Stripe $9/mo per capability.
 * Flag TOLL2_PROMOTE_LIVE default OFF → 503 stub (no charge, no subscription create).
 * When ON (future PR): create Checkout for STRIPE_CAPABILITY_PROMOTE_PRICE_ID.
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
  if (!isToll2PromoteLive()) {
    return NextResponse.json(
      {
        ...TOLL2_PROMOTE_OFF_BODY,
        shape_when_live: {
          body: { capability_id: "cap_…" },
          auth: "Authorization: Bearer ar_… or X-Merchant-Key",
          env: ["STRIPE_CAPABILITY_PROMOTE_PRICE_ID", "TOLL2_PROMOTE_LIVE"],
        },
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  // Flag ON but full Checkout not wired in this PR — refuse billing honestly.
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(
    {
      error: "toll2_promote_not_wired",
      live: false,
      hint: "TOLL2_PROMOTE_LIVE is on but promote Checkout is not implemented yet. Unset the flag; wait for price id + Checkout PR.",
      capability_id: typeof body.capability_id === "string" ? body.capability_id : null,
      price_usd_mo: 9,
    },
    { status: 501, headers: CORS_HEADERS }
  );
}
