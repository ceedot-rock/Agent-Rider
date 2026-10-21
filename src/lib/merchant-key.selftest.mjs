/**
 * Merchant key lookup hardening: a crafted header must not match another
 * merchant.
 *
 * Offline. No Stripe, no network, no database. Every key below is an
 * obviously fake placeholder (a single repeated hex digit), never a real key.
 *
 * The fake Stripe below evaluates a small slice of the Search query language
 * (field:'value' clauses joined by AND / OR). It is an emulation written for
 * this test, not Stripe itself: it shows what the OLD code would have asked
 * for and that the NEW code never sends such a query. It does not prove how
 * live Stripe parses a hostile string.
 *
 * Run: cd src && node lib/merchant-key.selftest.mjs
 */
import assert from "node:assert/strict";
import {
  MERCHANT_KEY_LENGTH,
  isWellFormedMerchantKey,
  buildMerchantKeySearchQuery,
  merchantKeyRef,
  findSubscriptionByMerchantKeyWith,
} from "./merchant-key-core.mjs";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// merchant-key.ts is TypeScript and plain Node (20/22) cannot import it, so the
// test pins the generator by reading its source and replicating its output shape.
const genSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "merchant-key.ts"), "utf8");
assert.match(genSrc, /new Uint8Array\(24\)/, "generator must use 24 random bytes");
assert.match(genSrc, /`merchant_live_\$\{hex\}`/, "generator must use the merchant_live_ prefix");
assert.match(genSrc, /padStart\(2, "0"\)/, "generator must emit lowercase hex, 2 chars per byte");
function generateMerchantKey() {
  return "merchant_live_" + randomBytes(24).toString("hex");
}

const KEY_A = "merchant_live_" + "a".repeat(48); // fake: merchant A (active)
const KEY_B = "merchant_live_" + "b".repeat(48); // fake: merchant B (canceled)
const KEY_NONE = "merchant_live_" + "c".repeat(48); // fake: matches nobody

const SUBS = [
  { id: "sub_FAKE_A", status: "active", metadata: { merchant_key: KEY_A } },
  { id: "sub_FAKE_B", status: "canceled", metadata: { merchant_key: KEY_B } },
];

// --- Minimal emulation of Stripe subscription search -------------------------
function evalClause(sub, clause) {
  const c = clause.trim();
  let m = c.match(/^metadata\['([^']+)'\]:'([^']*)'$/);
  if (m) return sub.metadata?.[m[1]] === m[2];
  m = c.match(/^status:['"]([^'"]*)['"]$/);
  if (m) return sub.status === m[1];
  return false;
}
function makeFakeSearch() {
  const calls = [];
  const search = async ({ query }) => {
    calls.push(query);
    // OR binds loosest, then AND.
    const data = SUBS.filter((s) =>
      query.split(/\s+OR\s+/).some((orPart) =>
        orPart.split(/\s+AND\s+/).every((cl) => evalClause(s, cl))
      )
    );
    return { data };
  };
  return { search, calls };
}

// The pre-fix lookup, reproduced to show the emulation catches the old hole.
async function oldLookup(search, key) {
  const result = await search({ query: `metadata['merchant_key']:'${key}'` });
  return result.data[0] ?? null;
}

// Hostile headers. None is a real key.
const HOSTILE = [
  "x' OR status:'active",
  "' OR status:'active",
  KEY_NONE + "' OR status:'active",
  KEY_B + "' OR metadata['merchant_key']:'" + KEY_A,
  "x' OR status:\"active",
  "merchant_live_" + "a".repeat(48) + "'",
  "merchant_live_" + "a".repeat(48) + " OR status:'active'",
  "merchant_live_" + "a".repeat(47) + "'",
  KEY_A + "\n",
  " " + KEY_A,
  KEY_A + " ",
  KEY_A.toUpperCase(),
  "merchant_live_" + "g".repeat(48),
  "merchant_live_" + "a".repeat(49),
  "merchant_live_" + "a".repeat(47),
  "merchant_test_" + "a".repeat(48),
  "",
  "'",
  "*",
  "metadata['merchant_key']:'" + KEY_A + "'",
];

// 0. Sanity: the emulation reproduces the OLD hole, so passing below means something.
{
  const { search } = makeFakeSearch();
  const old = await oldLookup(search, "x' OR status:'active");
  assert.ok(old, "emulation should show the old lookup matching an active sub from a crafted header");
  assert.equal(old.status, "active");
  const old2 = await oldLookup(search, KEY_B + "' OR metadata['merchant_key']:'" + KEY_A);
  assert.ok(old2, "old lookup widened by a crafted header");
}

// 1. Shape check accepts only what generateMerchantKey makes.
for (let i = 0; i < 50; i++) {
  const k = generateMerchantKey();
  assert.equal(k.length, MERCHANT_KEY_LENGTH);
  assert.ok(isWellFormedMerchantKey(k), "generated key must pass the allowlist");
}
assert.ok(isWellFormedMerchantKey(KEY_A));
for (const bad of HOSTILE) {
  assert.equal(isWellFormedMerchantKey(bad), false, "must reject: " + JSON.stringify(bad));
}
for (const bad of [undefined, null, 0, 1, {}, [], [KEY_A], true]) {
  assert.equal(isWellFormedMerchantKey(bad), false);
}

// 2. Query builder throws on anything malformed and never emits quotes from input.
for (const bad of HOSTILE) {
  assert.throws(() => buildMerchantKeySearchQuery(bad), /malformed_merchant_key/);
}
assert.equal(buildMerchantKeySearchQuery(KEY_A), `metadata['merchant_key']:'${KEY_A}'`);

// 3. Crafted headers never reach Stripe at all and never match anyone.
for (const bad of HOSTILE) {
  const { search, calls } = makeFakeSearch();
  const found = await findSubscriptionByMerchantKeyWith(search, bad);
  assert.equal(found, null, "crafted header matched a subscription: " + JSON.stringify(bad));
  assert.equal(calls.length, 0, "Stripe must not be queried for a malformed key");
}

// 4. A header built to match an ACTIVE subscription cannot act as that merchant.
{
  const { search } = makeFakeSearch();
  for (const attack of [
    "x' OR status:'active",
    KEY_B + "' OR metadata['merchant_key']:'" + KEY_A,
  ]) {
    const found = await findSubscriptionByMerchantKeyWith(search, attack);
    assert.equal(found, null);
  }
}

// 5. Legitimate lookups still work: exact key, right subscription, right status.
{
  const { search, calls } = makeFakeSearch();
  const a = await findSubscriptionByMerchantKeyWith(search, KEY_A);
  assert.equal(a.id, "sub_FAKE_A");
  assert.equal(a.status, "active");
  const b = await findSubscriptionByMerchantKeyWith(search, KEY_B);
  assert.equal(b.id, "sub_FAKE_B");
  assert.equal(b.status, "canceled"); // route layer rejects non-active statuses
  const none = await findSubscriptionByMerchantKeyWith(search, KEY_NONE);
  assert.equal(none, null);
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `metadata['merchant_key']:'${KEY_A}'`);
}

// 6. Defense in depth: even if Stripe returned the wrong subscription for a
//    well formed key (eventual consistency, a widened query, a bug), the
//    stored metadata must equal the presented key.
{
  const wrongHit = async () => ({ data: [SUBS[0]] }); // always returns merchant A (active)
  assert.equal(await findSubscriptionByMerchantKeyWith(wrongHit, KEY_NONE), null);
  assert.equal(await findSubscriptionByMerchantKeyWith(wrongHit, KEY_B), null);
  const emptyMeta = async () => ({ data: [{ id: "sub_FAKE_X", status: "active", metadata: {} }] });
  assert.equal(await findSubscriptionByMerchantKeyWith(emptyMeta, KEY_A), null);
  const noData = async () => ({});
  assert.equal(await findSubscriptionByMerchantKeyWith(noData, KEY_A), null);
  // First hit wrong, second right: still finds the right one.
  const mixed = async () => ({ data: [SUBS[1], SUBS[0]] });
  assert.equal((await findSubscriptionByMerchantKeyWith(mixed, KEY_A)).id, "sub_FAKE_A");
}

// 7. Rate limit reference never contains the key and is stable and distinct.
{
  const refA = merchantKeyRef(KEY_A);
  const refB = merchantKeyRef(KEY_B);
  assert.match(refA, /^[0-9a-f]{32}$/);
  assert.equal(refA, merchantKeyRef(KEY_A));
  assert.notEqual(refA, refB);
  assert.ok(!refA.includes("aaaaaaaa"), "reference must not echo key material");
  assert.ok(!`verify:${refA}`.includes(KEY_A));
  assert.ok(!`verify:${refA}`.includes("merchant_live_"));
}

console.log("merchant-key selftest OK");
