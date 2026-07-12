import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  stripe,
  retrieveSubscription,
  updateSubscriptionMetadata,
} from "@/lib/stripe";
import { generateMerchantKey } from "@/lib/merchant-key";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (subscriptionId) {
        const subscription = await retrieveSubscription(subscriptionId);
        if (!subscription.metadata?.merchant_key) {
          await updateSubscriptionMetadata(subscriptionId, {
            merchant_key: generateMerchantKey(),
          });
        }
      }
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
