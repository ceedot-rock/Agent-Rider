/**
 * Merchant key handling shared by every route that checks X-Merchant-Key or
 * the /api/verify body field.
 *
 * Why this file exists: the lookup used to paste the caller-supplied key into
 * a Stripe Search query unescaped, so a crafted header could widen the query
 * (for example with an OR clause) and match another merchant's subscription.
 * Three rules close that:
 *   1. Allowlist the exact key shape before anything else touches it.
 *   2. Only ever build the query from a key that passed rule 1.
 *   3. After the search, require the stored metadata to equal the presented
 *      key (constant time). A search hit alone never grants access.
 *
 * Also provides a one-way reference for counters and logs, so the raw key is
 * never used as a rate limit name.
 *
 * Pure module (no Stripe or DB imports) so the selftest can run offline.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const MERCHANT_KEY_PREFIX = "merchant_live_";
export const MERCHANT_KEY_HEX_LENGTH = 48; // 24 random bytes, lowercase hex
export const MERCHANT_KEY_LENGTH = MERCHANT_KEY_PREFIX.length + MERCHANT_KEY_HEX_LENGTH;
export const MERCHANT_KEY_RE = /^merchant_live_[0-9a-f]{48}$/;

/** True only for a string of exactly the shape generateMerchantKey() produces. */
export function isWellFormedMerchantKey(value) {
  return (
    typeof value === "string" &&
    value.length === MERCHANT_KEY_LENGTH &&
    MERCHANT_KEY_RE.test(value)
  );
}

/** Builds the Stripe Search query. Refuses anything that is not a well formed key. */
export function buildMerchantKeySearchQuery(key) {
  if (!isWellFormedMerchantKey(key)) {
    throw new TypeError("malformed_merchant_key");
  }
  return `metadata['merchant_key']:'${key}'`;
}

/**
 * One-way reference for rate limit names and logs. 32 hex chars of SHA-256
 * over a domain-separated input. The key is 192 bits of randomness, so the
 * reference does not help anyone recover it.
 */
export function merchantKeyRef(key) {
  return createHash("sha256")
    .update(`merchant-key-ref:v1:${String(key)}`)
    .digest("hex")
    .slice(0, 32);
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Finds the subscription whose metadata holds exactly this key.
 * `search` is stripe.subscriptions.search (or a fake in tests).
 * Returns null for a malformed key WITHOUT calling `search` at all.
 */
export async function findSubscriptionByMerchantKeyWith(search, key) {
  if (!isWellFormedMerchantKey(key)) return null;
  const result = await search({ query: buildMerchantKeySearchQuery(key), limit: 10 });
  for (const sub of result?.data ?? []) {
    if (safeEqual(sub?.metadata?.merchant_key, key)) return sub;
  }
  return null;
}
