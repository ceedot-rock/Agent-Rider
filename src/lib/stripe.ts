// lib/stripe.ts — minimal Stripe integration via raw fetch (no SDK dependency,
// keeps the app lean and edge-compatible).

const STRIPE_API = "https://api.stripe.com/v1";

function authHeader() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export async function createCheckoutSession(params: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}) {
  const body: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": params.priceId,
    "line_items[0][quantity]": "1",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  };
  if (params.customerEmail) body.customer_email = params.customerEmail;

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      ...authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe checkout session failed: ${err}`);
  }
  return res.json();
}

export async function retrieveSession(sessionId: string) {
  const res = await fetch(
    `${STRIPE_API}/checkout/sessions/${sessionId}?expand[]=customer&expand[]=subscription`,
    { headers: authHeader() }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe session retrieve failed: ${err}`);
  }
  return res.json();
}

export function constructEventUnsafe(rawBody: string) {
  return JSON.parse(rawBody);
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): Promise<boolean> {
  const parts = signatureHeader.split(",").reduce((acc: Record<string, string>, part) => {
    const [k, v] = part.split("=");
    acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === signature;
}
