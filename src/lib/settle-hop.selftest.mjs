/**
 * Dry prove: missing CDP keys do not block when facilitator is XPay.
 * No real USDC spend — mock fetch for settle path + live /verify probe
 * that expects a validation error (not 401).
 *
 * Run: node src/lib/settle-hop.selftest.mjs
 *  (from repo root) or: node settle-hop.selftest.mjs (from src/lib)
 */

const XPAY = "https://facilitator.xpay.sh";
const CDP = "https://api.cdp.coinbase.com/platform/v2/x402";

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- pure rules ---
{
  const env = { X402_FACILITATOR: XPAY };
  delete env.CDP_API_KEY_ID;
  delete env.CDP_API_KEY_SECRET;
  const fac = resolveFacilitator(env);
  assert(fac === XPAY, "env X402_FACILITATOR must win");
  assert(!usesCdpAuth(fac), "XPay must not use CDP auth");
  const h = await facilitatorHeaders(fac, env);
  assert(!h.Authorization, "XPay headers must not include Authorization without CDP");
}

{
  const fac = resolveFacilitator({});
  assert(fac === XPAY, "default facilitator must be XPay");
  assert(!usesCdpAuth(fac), "default must not require CDP");
}

{
  const fac = resolveFacilitator({ X402_FACILITATOR: CDP });
  assert(usesCdpAuth(fac), "CDP host should use CDP auth path");
  const noKeys = await facilitatorHeaders(fac, {});
  assert(!noKeys.Authorization, "missing CDP keys must not invent Authorization");
  const withKeys = await facilitatorHeaders(fac, {
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
  });
  assert(!!withKeys.Authorization, "CDP keys present → Authorization attached");
}

// --- mock settle path: no CDP, XPay, payment present → fetch called without Authorization ---
{
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (String(url).endsWith("/verify")) {
      return {
        json: async () => ({ isValid: true }),
      };
    }
    return {
      json: async () => ({ success: true, transaction: "dry" }),
    };
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
}

// --- live dry probe (no USDC): empty body → validation error, not auth failure ---
{
  const res = await fetch(`${XPAY}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  assert(res.status !== 401 && res.status !== 403, `XPay /verify must not require auth (got ${res.status})`);
  assert(
    body.isValid === false || body.error || body.invalidReason,
    "expected validation-style response from dry /verify"
  );
  console.log("xpay_dry_verify", { status: res.status, invalidReason: body.invalidReason || body.error });
}

console.log("ok settle-hop xpay dry (no CDP required)");
