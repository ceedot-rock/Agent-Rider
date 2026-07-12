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

export async function createCheckoutSession(params: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}) {
  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
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
