import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error(
    "Missing STRIPE_SECRET_KEY environment variable. Set it in Vercel project settings (Production/Preview) or your local .env file."
  );
}

export const stripe = new Stripe(secretKey, {
  apiVersion: "2026-06-24.dahlia",
  typescript: true,
});

// 7-day free trial on every new Merchant Gate subscription. The rest of the
// codebase already treats a `trialing` subscription as fully valid —
// /api/rider/issue and /api/verify both check ACTIVE_STATUSES = {"active",
// "trialing"} — so a merchant can mint riders immediately during the trial,
// no separate trial-specific gating needed. /api/provision's completion
// check (session.status === "complete") also already covers a $0-due
// trial checkout, since that's independent of whether payment was
// collected upfront.
const TRIAL_PERIOD_DAYS = 7;

export async function createCheckoutSession(params: {
  priceId: string;
  meteredPriceId?: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}) {
  // Metered/usage-based prices must not carry a `quantity` — Stripe derives
  // it from reported meter events, not from the line item.
  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: params.priceId, quantity: 1 },
  ];
  if (params.meteredPriceId) line_items.push({ price: params.meteredPriceId });

  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items,
    subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
  });
}

// Credits buy-in — a one-time payment, not a subscription. Uses inline
// price_data instead of a dashboard-created Price (unlike Merchant Gate)
// since the amount is chosen per-purchase, not fixed. participant_id +
// credits ride in session metadata so the webhook knows who to credit and
// how much without a second round trip.
export async function createCreditsCheckoutSession(params: {
  participantId: string;
  credits: number;
  usdCents: number;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Agent^Rider credits (${params.credits} AGC)` },
          unit_amount: params.usdCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      kind: "credits_purchase",
      participant_id: params.participantId,
      credits: String(params.credits),
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export async function retrieveSession(sessionId: string) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer", "subscription"],
  });
}

export async function retrieveSubscription(subscriptionId: string) {
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function updateSubscriptionMetadata(
  subscriptionId: string,
  metadata: Record<string, string>
) {
  return stripe.subscriptions.update(subscriptionId, { metadata });
}

// Stripe's Search API is eventually consistent — a subscription written
// moments ago may not be found for a few seconds.
export async function findSubscriptionByMerchantKey(key: string) {
  const result = await stripe.subscriptions.search({
    query: `metadata['merchant_key']:'${key}'`,
  });
  return result.data[0] ?? null;
}

// Reports one billable /api/verify call above the free tier to Stripe's
// Billing Meters API. Requires a Meter named STRIPE_VERIFY_METER_NAME to
// exist in the Stripe dashboard with a metered Price attached to it, added
// as a second subscription item on the merchant's Merchant Gate
// subscription — that wiring is a one-time dashboard/checkout step, not
// something this call can create on its own. Until METER_NAME is set this
// is a deliberate no-op so free-tier verification keeps working unmetered.
const VERIFY_METER_NAME = process.env.STRIPE_VERIFY_METER_NAME;

export async function reportVerifyOverage(customerId: string): Promise<void> {
  if (!VERIFY_METER_NAME || !customerId) return;
  try {
    await stripe.billing.meterEvents.create({
      event_name: VERIFY_METER_NAME,
      payload: { stripe_customer_id: customerId, value: "1" },
    });
  } catch (err) {
    // Fail open — a metering hiccup must never block a merchant's
    // verification call.
    console.error("reportVerifyOverage failed", (err as Error).message);
  }
}
