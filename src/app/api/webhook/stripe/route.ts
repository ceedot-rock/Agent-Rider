import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const valid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      console.log("checkout completed", session.id, session.customer);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      console.log("subscription cancelled", sub.id);
      break;
    }
    default:
      console.log("unhandled event", event.type);
  }

  return NextResponse.json({ received: true });
}
