import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";
import { checkCheckoutLimit, getClientIp } from "@/lib/rate-limit";

const MERCHANT_GATE_PRICE_ID = "price_1TsQAOK8JsmXFzvIKmUsVDoK";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const rl = await checkCheckoutLimit(getClientIp(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  try {
    const origin = req.headers.get("origin") || SITE_URL;
    let email: string | undefined;
    try {
      const body = await req.json();
      if (body?.email !== undefined) {
        if (typeof body.email !== "string" || !EMAIL_RE.test(body.email)) {
          return NextResponse.json({ error: "invalid_email" }, { status: 400 });
        }
        email = body.email;
      }
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
