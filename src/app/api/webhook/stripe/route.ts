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
import { setCapabilityPromotion } from "@/lib/capabilities";

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

// Toll balance top-up: a completed one-time checkout with
// metadata.gate = "toll_balance_topup" credits toll_mock_balances for the
// agent. Idempotent via claimEvent in the caller.
async function handleTollBalanceTopup(session: Stripe.Checkout.Session): Promise<void> {
  const agentId = session.metadata?.agent_id;
  const uusdc = Number(session.metadata?.uusdc);
  if (!agentId || !Number.isFinite(uusdc) || uusdc <= 0) {
    console.error("toll_balance_topup webhook: missing/invalid metadata", session.id, session.metadata);
    return;
  }

  const db = getDB();
  const { data: row } = await db
    .from("toll_mock_balances")
    .select("balance_uusdc")
    .eq("agent_id", agentId)
    .maybeSingle();
  const next = Number(row?.balance_uusdc ?? 0) + uusdc;
  const { error } = await db
    .from("toll_mock_balances")
    .upsert({ agent_id: agentId, balance_uusdc: next }, { onConflict: "agent_id" });
  if (error) throw new Error(`toll_balance_topup upsert failed: ${error.message}`);
  await db.from("toll_mock_ledger").insert({
    tx_hash: `topup_${session.id}`,
    sender: "stripe",
    recipient: agentId,
    amount_uusdc: uusdc,
    memo: `toll topup $${((session.amount_total ?? 0) / 100).toFixed(2)}`,
    created_at: Date.now(),
  });
  console.log(`toll_balance_topup: agent ${agentId} +${uusdc} uusdc (session ${session.id})`);
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

      if (session.mode === "payment" && session.metadata?.gate === "toll_balance_topup") {
        if (await claimEvent(event.id)) {
          await handleTollBalanceTopup(session);
        } else {
          console.log("toll_balance_topup webhook already processed, skipping", event.id);
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
        // Toll 2 promote fulfillment: flip the capability's placement.
        const meta = subscription.metadata ?? session.metadata ?? {};
        if (meta.gate === "toll2_promote" && typeof meta.capability_id === "string") {
          if (await claimEvent(event.id + ":toll2_promote")) {
            const periodEnd =
              typeof (subscription as unknown as { current_period_end?: unknown })
                .current_period_end === "number"
                ? (subscription as unknown as { current_period_end: number })
                    .current_period_end
                : Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
            const res = await setCapabilityPromotion(
              meta.capability_id,
              true,
              new Date(periodEnd * 1000).toISOString()
            );
            console.log(
              "toll2_promote fulfilled",
              meta.capability_id,
              res.store,
              res.dbError ?? ""
            );
          }
        }
      }
      console.log("checkout completed", session.id, session.customer);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const meta = (sub as { metadata?: Record<string, string> }).metadata ?? {};
      if (meta.gate === "toll2_promote" && typeof meta.capability_id === "string") {
        if (await claimEvent(event.id + ":toll2_promote_end")) {
          const res = await setCapabilityPromotion(meta.capability_id, false, null);
          console.log("toll2_promote ended", meta.capability_id, res.store);
        }
      } else {
        console.log("subscription cancelled", sub.id);
      }
      break;
    }
    default:
      console.log("unhandled event", event.type);
  }

  return NextResponse.json({ received: true });
}
