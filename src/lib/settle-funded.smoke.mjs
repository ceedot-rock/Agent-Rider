/**
 * Funded Base USDC SettleHop smoke — fail-closed without secrets.
 *
 *   cd src && npm run smoke:settle:funded
 *
 * Requires (never printed):
 *   SETTLE_FUNDED=1
 *   AR_API_KEY (or AGENT_RIDER_API_KEY) — vaulted ar_…
 *   SETTLE_PAYER_PRIVATE_KEY — 0x… Base EOA with USDC
 *
 * Optional: LIVE_BASE, SETTLE_AMOUNT_USD (default 0.01)
 *
 * Exit 1 if secrets missing or settle fails. Exit 0 only on successful 200 settle.
 * Dry CI path: use settle-hop.selftest.mjs (no spend).
 */

import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../package.json"));

const LIVE_BASE = (process.env.LIVE_BASE || "https://agentrider.fly.dev").replace(/\/+$/, "");
const AMOUNT_USD = Number(process.env.SETTLE_AMOUNT_USD || "0.01");
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function redactedPresence(name, value) {
  if (!value) return `${name}=missing`;
  const s = String(value);
  return `${name}=set(len=${s.length})`;
}

function missingSecrets() {
  const funded = process.env.SETTLE_FUNDED === "1" || process.env.SETTLE_FUNDED === "true";
  const ar = process.env.AR_API_KEY || process.env.AGENT_RIDER_API_KEY || "";
  const pk = process.env.SETTLE_PAYER_PRIVATE_KEY || "";
  const missing = [];
  if (!funded) missing.push("SETTLE_FUNDED");
  if (!ar) missing.push("AR_API_KEY|AGENT_RIDER_API_KEY");
  if (!pk) missing.push("SETTLE_PAYER_PRIVATE_KEY");
  return { missing, funded, ar, pk };
}

function failClosed(missing) {
  console.error("FAIL  smoke:settle:funded — fail-closed (secrets incomplete)");
  console.error("  missing:", missing.join(", "));
  console.error(
    "  present:",
    [
      redactedPresence("SETTLE_FUNDED", process.env.SETTLE_FUNDED),
      redactedPresence("AR_API_KEY", process.env.AR_API_KEY || process.env.AGENT_RIDER_API_KEY),
      redactedPresence("SETTLE_PAYER_PRIVATE_KEY", process.env.SETTLE_PAYER_PRIVATE_KEY),
    ].join(" ")
  );
  console.error("  docs: docs/SETTLE_SMOKE.md");
  console.error("  Never print ar_ or private keys. CI cannot run funded settle without operator secrets.");
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function issueRider(arKey) {
  const res = await fetch(`${LIVE_BASE}/api/rider/issue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${arKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ level: "L1", scopes: ["*"] }),
  });
  const body = await res.json().catch(() => ({}));
  assert(res.status === 200 || res.status === 201, `rider issue HTTP ${res.status} error=${body.error || "?"}`);
  assert(typeof body.rider === "string" && body.rider.length > 20, "rider JWT missing in issue response");
  return body.rider;
}

async function postSettle({ rider, paymentHeader, hop }) {
  const headers = {
    "content-type": "application/json",
    "X-Agent-Rider": rider,
  };
  if (paymentHeader) headers["X-PAYMENT"] = paymentHeader;
  const res = await fetch(`${LIVE_BASE}/api/settle`, {
    method: "POST",
    headers,
    body: JSON.stringify(hop),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function pickUsdcAccept(accepts) {
  const list = Array.isArray(accepts) ? accepts : [];
  const usdc = list.find(
    (a) =>
      String(a.asset || "").toLowerCase() === USDC_BASE.toLowerCase() &&
      (a.network === "base" || a.network === "eip155:8453")
  );
  return usdc || list.find((a) => String(a.asset || "").toLowerCase() === USDC_BASE.toLowerCase()) || list[0];
}

async function signExactPayment(accept, privateKey) {
  const { privateKeyToAccount } = require("viem/accounts");
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(pk);

  const value = String(accept.maxAmountRequired || accept.amount || "10000");
  const to = accept.payTo;
  const asset = accept.asset;
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0;
  const validBefore = now + Math.min(Number(accept.maxTimeoutSeconds || 180), 600);
  const nonce = `0x${randomBytes(32).toString("hex")}`;

  const eip712Name = accept.extra?.name || "USD Coin";
  const eip712Version = accept.extra?.version || "2";
  const chainId = accept.network === "base-sepolia" || accept.network === "eip155:84532" ? 84532 : 8453;

  const authorization = {
    from: account.address,
    to,
    value,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: eip712Name,
      version: eip712Version,
      chainId,
      verifyingContract: asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const payment = {
    x402Version: 1,
    scheme: "exact",
    network: accept.network === "eip155:8453" ? "base" : accept.network,
    asset,
    payload: {
      signature,
      authorization,
    },
  };

  // Prefer raw JSON (settle-hop accepts JSON or base64)
  return JSON.stringify(payment);
}

async function main() {
  const { missing, ar, pk } = missingSecrets();
  if (missing.length) failClosed(missing);

  assert(Number.isFinite(AMOUNT_USD) && AMOUNT_USD > 0, "SETTLE_AMOUNT_USD must be > 0");
  console.log("PASS  secrets_present (names only; values not printed)");
  console.log("  info", {
    live_base: LIVE_BASE,
    amount_usd: AMOUNT_USD,
    payer_fingerprint: createHash("sha256").update(String(pk).slice(0, 8)).digest("hex").slice(0, 8),
  });

  const rider = await issueRider(ar);
  console.log("PASS  rider_issued (JWT not printed)");

  const hopId = `funded-smoke-${Date.now()}`;
  const hop = {
    hop_id: hopId,
    job_id: hopId,
    key_id: `x402:${hopId}`,
    amount_usd: AMOUNT_USD,
    meter: { egress_gb: 0, compute_s: 0, codec_s: 0 },
  };

  const req = await postSettle({ rider, paymentHeader: null, hop });
  assert(req.status === 402, `expected 402 payment_required, got ${req.status} error=${req.body.error}`);
  assert(Array.isArray(req.body.accepts) && req.body.accepts.length > 0, "402 missing accepts[]");
  console.log("PASS  payment_requirement", {
    status: req.status,
    error: req.body.error,
    accepts: req.body.accepts.length,
    facilitator: req.body.facilitator,
  });

  const accept = pickUsdcAccept(req.body.accepts);
  assert(accept?.payTo && accept?.asset, "accept missing payTo/asset");
  assert(
    String(accept.asset).toLowerCase() === USDC_BASE.toLowerCase(),
    `funded smoke is USDC-only; got asset ${accept.asset}`
  );

  const paymentHeader = await signExactPayment(accept, pk);
  console.log("PASS  x_payment_signed", {
    network: accept.network,
    asset: "USDC",
    eip712Name: accept.extra?.name || "USD Coin",
  });

  const settled = await postSettle({ rider, paymentHeader, hop });
  if (settled.status !== 200 || settled.body.error) {
    console.error("FAIL  settle", {
      status: settled.status,
      error: settled.body.error,
      hint: settled.body.hint,
      // do not dump full verified/settled blobs if they embed payloads
      verified_valid: settled.body.verified?.isValid,
      settle_success: settled.body.settled?.success,
    });
    process.exit(1);
  }
  console.log("PASS  settle_funded", {
    status: settled.status,
    rail: settled.body.rail,
    asset: settled.body.asset,
    network: settled.body.network,
  });
  console.log("ok funded Base USDC hop settle");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL  smoke:settle:funded:", err.message || err);
  process.exit(1);
});
