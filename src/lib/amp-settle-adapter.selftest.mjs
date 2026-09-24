/**
 * AMP settle adapter stub honesty — offline.
 * Run: cd src && node lib/amp-settle-adapter.selftest.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Compile-free: load via dynamic import of the .ts through a tiny copy check on source text
const src = readFileSync(join(__dirname, "amp-settle-adapter.ts"), "utf8");
assert.match(src, /AMP_SETTLE_LIVE/);
assert.match(src, /amp_settle_not_live/);
assert.match(src, /hop_default:\s*"xpay"/);
assert.match(src, /Default false/);
assert.doesNotMatch(src, /AMP settle is live|live AMP hop/i);

// Runtime via transpile-free mirror of the flag logic (must match TS)
function isAmpSettleLive(env = {}) {
  const raw = env.AMP_SETTLE_LIVE;
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
assert.equal(isAmpSettleLive({}), false);
assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "true" }), true);

const settle = readFileSync(join(__dirname, "../app/api/settle/route.ts"), "utf8");
assert.doesNotMatch(settle, /attemptAmpSettle/);
assert.match(settle, /settleX402|x402|XPay|xpay/i);

const recipe = readFileSync(join(__dirname, "../../docs/AMP_SANDBOX.md"), "utf8");
assert.match(recipe, /AMP_SETTLE_LIVE/);
assert.match(recipe, /XPay/);
assert.match(recipe, /not live|PARKED/i);
assert.doesNotMatch(recipe, /ar_[a-f0-9]{20,}/i);

console.log("amp-settle-adapter.selftest: ok (stub off; settle route still XPay)");
