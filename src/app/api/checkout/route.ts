import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/stripe";

const MERCHANT_GATE_PRICE_ID = "price_1TsQAOK8JsmXFzvIKmUsVDoK";

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin") || "https://agentrider.vercel.app";
    let email: string | undefined;
    try {
      const body = await req.json();
      email = body?.email;
    } catch {
      // no body sent — fine, email is optional
    }

    const session = await createCheckoutSession({
      priceId: MERCHANT_GATE_PRICE_ID,
      successUrl: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/`,
      customerEmail: email,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("checkout error", err);
    return NextResponse.json(
      { error: err?.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
