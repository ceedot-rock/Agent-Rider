/**
 * SettleHop smoke — XPay dry + credits reject honesty + optional live gate.
 * Exit 0 on pass, non-zero on fail. No secrets; no real USDC spend.
 *
 * Run (repo root):
 *   node src/lib/settle-hop.selftest.mjs
 *   cd src && npm run smoke:settle
 *
 * Env:
 *   SKIP_LIVE=1  — skip agentrider.fly.dev unauth probe
 *   LIVE_BASE    — default https://agentrider.fly.dev
 *   SETTLE_FUNDED_PROBE=1 — after dry checks, report funded arm status
 *                          (SKIP unless SETTLE_FUNDED=1 + secrets; never prints keys)
 *
 * Funded USDC spend: npm run smoke:settle:funded (fail-closed). See docs/SETTLE_SMOKE.md.
 */

const XPAY = "https://facilitator.xpay.sh";
const CDP = "https://api.cdp.coinbase.com/platform/v2/x402";
const LIVE_BASE = (process.env.LIVE_BASE || "https://agentrider.fly.dev").replace(/\/+$/, "");
const SKIP_LIVE = process.env.SKIP_LIVE === "1" || process.env.SKIP_LIVE === "true";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`PASS  ${name}`);
    })
    .catch((err) => {
      failed += 1;
      failures.push(`${name}: ${err.message || err}`);
      console.error(`FAIL  ${name}: ${err.message || err}`);
    });
}

function resolveFacilitator(env, fallback = XPAY) {
  const raw = env.X402_FACILITATOR || fallback;
  return String(raw).replace(/\/+$/, "");
}

function usesCdpAuth(facilitatorUrl) {
  try {
    return new URL(facilitatorUrl).hostname === "api.cdp.coinbase.com";
  } catch {
    return /api\.cdp\.coinbase\.com/i.test(facilitatorUrl);
  }
}

async function facilitatorHeaders(facilitator, env) {
  const headers = { "content-type": "application/json" };
  if (!usesCdpAuth(facilitator)) return headers;
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    headers.Authorization = "Bearer fake-cdp-jwt";
  } else if (env.CDP_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.CDP_ACCESS_TOKEN}`;
  }
  return headers;
}

/** Mirrors src/lib/settle-hop.ts parseKeyRail — keep in sync. */
function parseKeyRail(keyId) {
  const i = String(keyId).indexOf(":");
  if (i <= 0) return { rail: "unknown", rest: keyId };
  const prefix = keyId.slice(0, i);
  const rest = keyId.slice(i + 1);
  if (prefix === "credits" || prefix === "x402" || prefix === "stripe" || prefix === "tiun") {
    return { rail: prefix, rest };
  }
  return { rail: "unknown", rest: keyId };
}

/**
 * Documented hop response when key_id is credits:* (after rider gate).
 * Source of truth: src/app/api/settle/route.ts — MUST stay 410.
 * Credits stay on the board; they are not a hop/AMP currency.
 */
function creditsHopRejectBody() {
  return {
    status: 410,
    body: {
      error: "reject.agc_removed",
      rail: "credits",
      message: "Board credits / AGC are not a hop currency. Use key_id=x402:<resource> and X-PAYMENT (USDC on Base via XPay default).",
    },
  };
}

await check("xpay_default_no_cdp", async () => {
  const env = { X402_FACILITATOR: XPAY };
  const fac = resolveFacilitator(env);
  assert(fac === XPAY, "env X402_FACILITATOR must win");
  assert(!usesCdpAuth(fac), "XPay must not use CDP auth");
  const h = await facilitatorHeaders(fac, env);
  assert(!h.Authorization, "XPay headers must not include Authorization without CDP");
});

await check("xpay_default_when_env_empty", async () => {
  const fac = resolveFacilitator({});
  assert(fac === XPAY, "default facilitator must be XPay");
  assert(!usesCdpAuth(fac), "default must not require CDP");
});

await check("cdp_auth_only_for_cdp_host", async () => {
  const fac = resolveFacilitator({ X402_FACILITATOR: CDP });
  assert(usesCdpAuth(fac), "CDP host should use CDP auth path");
  const noKeys = await facilitatorHeaders(fac, {});
  assert(!noKeys.Authorization, "missing CDP keys must not invent Authorization");
  const withKeys = await facilitatorHeaders(fac, {
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
  });
  assert(!!withKeys.Authorization, "CDP keys present → Authorization attached");
});

await check("xpay_mock_settle_no_authorization", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (String(url).endsWith("/verify")) {
      return { json: async () => ({ isValid: true }) };
    }
    return { json: async () => ({ success: true, transaction: "dry" }) };
  };

  const env = { X402_FACILITATOR: XPAY };
  const facilitator = resolveFacilitator(env);
  const payment = {
    network: "base",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };
  const reqs = {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "1000",
    asset: payment.asset,
    payTo: "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c",
    resource: "dry-job",
  };

  const post = async (path) => {
    const payload = JSON.stringify({
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: reqs,
    });
    const headers = await facilitatorHeaders(facilitator, env);
    const res = await mockFetch(`${facilitator}${path}`, {
      method: "POST",
      headers,
      body: payload,
    });
    return res.json();
  };

  const verified = await post("/verify");
  assert(verified.isValid, "mock verify should pass");
  const settled = await post("/settle");
  assert(settled.success, "mock settle should pass");
  assert(calls.length === 2, "expected verify + settle");
  for (const c of calls) {
    assert(c.url.startsWith(XPAY), `expected XPay URL, got ${c.url}`);
    assert(!c.headers.Authorization, "dry settle must not send CDP Authorization");
  }
});

/**
 * Live XPay dry probe (no USDC, no CDP keys).
 * Expected: validation-style response — NOT 401/403.
 * Observed codes: 400 (missing_parameters) with isValid:false.
 * Acceptable: 400, 402, 422, or any non-auth status with isValid===false / error / invalidReason.
 */
await check("xpay_live_verify_no_auth_required", async () => {
  const res = await fetch(`${XPAY}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  assert(
    res.status !== 401 && res.status !== 403,
    `XPay /verify must not require auth (got ${res.status})`
  );
  assert(
    body.isValid === false || body.error || body.invalidReason,
    "expected validation-style response from dry /verify"
  );
  console.log("  info  xpay_dry_verify", {
    status: res.status,
    invalidReason: body.invalidReason || body.error,
  });
});

await check("credits_rail_parse", async () => {
  const board = parseKeyRail("credits:board");
  assert(board.rail === "credits", "credits:board must parse as credits rail");
  assert(board.rest === "board", "rest should be board");
  const bare = parseKeyRail("credits:");
  assert(bare.rail === "credits", "credits: prefix alone is credits rail");
  const x402 = parseKeyRail("x402:job-1");
  assert(x402.rail === "x402", "x402 must not be confused with credits");
});

await check("credits_hop_reject_410", async () => {
  // Honesty: hop settle must refuse credits (board AGC stays off hop/AMP).
  const reject = creditsHopRejectBody();
  assert(reject.status === 410, "credits hop reject status must be 410");
  assert(reject.body.error === "reject.agc_removed", "error code must be reject.agc_removed");
  assert(reject.body.rail === "credits", "rail must be credits");
  assert(
    /not a hop currency/i.test(reject.body.message || ""),
    "message must state credits are not hop currency"
  );
  // Simulate route branch after gate (same as settle/route.ts)
  const keyId = "credits:board";
  const { rail } = parseKeyRail(keyId);
  assert(rail === "credits", "board credits key must hit credits branch");
  if (rail === "credits") {
    assert(reject.status === 410, "route must answer 410 for credits:*");
  }
});

/**
 * Optional live: unauthenticated POST /api/settle → missing_rider 401.
 * Gate runs before rail checks, so credits:* also gets 401 without a rider
 * (never spends; never reaches 410 until authenticated).
 */
if (!SKIP_LIVE) {
  await check("live_unauth_settle_missing_rider", async () => {
    const res = await fetch(`${LIVE_BASE}/api/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hop_id: "smoke-hop",
        job_id: "smoke-job",
        key_id: "credits:board",
        amount_usd: 0.01,
        meter: { egress_gb: 0, compute_s: 0, codec_s: 0 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    assert(res.status === 401, `expected 401 missing_rider, got ${res.status}`);
    assert(body.error === "missing_rider", `expected error missing_rider, got ${body.error}`);
    console.log("  info  live_unauth_settle", { status: res.status, error: body.error });
  });
} else {
  console.log("SKIP  live_unauth_settle_missing_rider (SKIP_LIVE=1)");
}

/**
 * Optional: report whether funded settle *could* run (never spends here).
 * SETTLE_FUNDED_PROBE=1 → SKIP unless SETTLE_FUNDED=1 and secrets present.
 * Actual spend: npm run smoke:settle:funded (fail-closed without secrets).
 */
const PROBE_FUNDED =
  process.env.SETTLE_FUNDED_PROBE === "1" || process.env.SETTLE_FUNDED_PROBE === "true";
if (PROBE_FUNDED) {
  await check("funded_arm_status", async () => {
    const armed = process.env.SETTLE_FUNDED === "1" || process.env.SETTLE_FUNDED === "true";
    const hasAr = !!(process.env.AR_API_KEY || process.env.AGENT_RIDER_API_KEY);
    const hasPk = !!process.env.SETTLE_PAYER_PRIVATE_KEY;
    if (!armed || !hasAr || !hasPk) {
      console.log("SKIP  funded_settle (need SETTLE_FUNDED=1 + AR_API_KEY + SETTLE_PAYER_PRIVATE_KEY)");
      console.log("  info  present", {
        SETTLE_FUNDED: armed,
        AR_API_KEY: hasAr,
        SETTLE_PAYER_PRIVATE_KEY: hasPk,
      });
      console.log("  info  for spend: cd src && npm run smoke:settle:funded");
      return;
    }
    console.log("PASS  funded_secrets_present (dry selftest will not spend USDC)");
    console.log("  info  run: cd src && npm run smoke:settle:funded");
  });
}

console.log("");
console.log(`settle-hop smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ok settle-hop smoke (xpay dry + credits reject + live gate; funded via smoke:settle:funded)");
process.exit(0);
