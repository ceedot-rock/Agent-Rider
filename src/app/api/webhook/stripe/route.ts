import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  stripe,
  retrieveSubscription,
  updateSubscriptionMetadata,
} from "@/lib/stripe";
import { generateMerchantKey } from "@/lib/merchant-key";
import { getDB } from "@/lib/db";
import { adjustCredits } from "@/lib/agents";

// Marks a Stripe event as processed, returning false if it already was
// (unique violation on event_id) — the caller should skip re-processing in
// that case. A thrown (non-unique-violation) error propagates so the route
// returns non-200 and Stripe retries later instead of silently dropping a
// real failure.
async function claimEvent(eventId: string): Promise<boolean> {
  const { error } = await getDB().from("processed_webhook_events").insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`claimEvent: ${error.message}`);
}

async function handleCreditsPurchase(session: Stripe.Checkout.Session): Promise<void> {
  const participantId = session.metadata?.participant_id;
  const credits = Number(session.metadata?.credits);
  if (!participantId || !Number.isFinite(credits) || credits <= 0) {
    console.error("credits_purchase webhook: missing/invalid metadata", session.id, session.metadata);
    return;
  }

  await adjustCredits(participantId, credits, "credits_purchase", {
    sessionId: session.id,
    usdCents: session.amount_total,
  });
}

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

      if (session.mode === "payment" && session.metadata?.kind === "credits_purchase") {
        if (await claimEvent(event.id)) {
          await handleCreditsPurchase(session);
        } else {
          console.log("credits_purchase webhook already processed, skipping", event.id);
        }
        break;
      }

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
