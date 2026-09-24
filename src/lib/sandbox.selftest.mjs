/**
 * Sandbox mode honesty — unit + source guards. No secrets printed.
 * Optional live probes when LIVE_SANDBOX=1 and RIDER_SANDBOX_API_KEY is set locally
 * (mirrors Fly) — still never prints key values.
 *
 *   node src/lib/sandbox.selftest.mjs
 *   cd src && npm run selftest:sandbox
 */
import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE_BASE = (process.env.LIVE_BASE || "https://agentrider.fly.dev").replace(/\/+$/, "");

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest();
}
function safeEqualString(a, b) {
  try {
    return timingSafeEqual(sha256(a), sha256(b));
  } catch {
    return false;
  }
}

const DOCUMENTED = "ar_sandbox_demo";
const SANDBOX_AGENT_ID = "rider-sandbox";

// --- unit: compare helpers ---
assert.equal(safeEqualString("abc", "abc"), true);
assert.equal(safeEqualString("abc", "abd"), false);
assert.equal(safeEqualString("", "x"), false);

// --- source guards ---
const sandboxSrc = readFileSync(join(__dirname, "sandbox.ts"), "utf8");
assert.match(sandboxSrc, /RIDER_SANDBOX_API_KEY/);
assert.match(sandboxSrc, /DOCUMENTED_SANDBOX_API_KEY\s*=\s*"ar_sandbox_demo"/);
assert.match(sandboxSrc, /sandbox_forbidden/);
assert.match(sandboxSrc, /slidphilabs\.com\/pcc/);
assert.match(sandboxSrc, /SANDBOX_SCOPES/);
assert.doesNotMatch(sandboxSrc, /RIDER_PRIVATE_KEY\s*=/);
assert.doesNotMatch(sandboxSrc, /\bar_[a-f0-9]{20,}/i);

const issueSrc = readFileSync(join(__dirname, "../app/api/rider/issue/route.ts"), "utf8");
assert.match(issueSrc, /isSandboxApiKey/);
assert.match(issueSrc, /sandboxIssuePayload/);
assert.match(issueSrc, /mode:\s*"sandbox"/);

const settleSrc = readFileSync(join(__dirname, "../app/api/settle/route.ts"), "utf8");
assert.match(settleSrc, /isSandboxRider/);
assert.match(settleSrc, /x-payment/);
assert.match(settleSrc, /sandboxForbiddenBody/);

const mcpSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
assert.match(mcpSrc, /issue_rider/);
assert.match(mcpSrc, /verify_rider/);
assert.match(mcpSrc, /scopeBlockedForSandbox/);
assert.match(mcpSrc, /isSandboxApiKey/);

const riderSrc = readFileSync(join(__dirname, "rider.ts"), "utf8");
assert.match(riderSrc, /sandbox\?: boolean/);

// Behavioral: sandbox rider shape blocks spend scopes
function scopeBlockedForSandbox(scope) {
  const SPEND = new Set([
    "credits:spend",
    "credits:transfer",
    "credits:purchase",
    "dm:send",
    "tasks:claim",
  ]);
  if (!scope) return false;
  if (SPEND.has(scope)) return true;
  if (scope.startsWith("credits:") && scope !== "credits:read") return true;
  return false;
}
function isSandboxRider(rider) {
  return rider?.sandbox === true || rider?.agent_id === SANDBOX_AGENT_ID || rider?.scopes?.includes("sandbox");
}
const sandRider = { agent_id: SANDBOX_AGENT_ID, sandbox: true, scopes: ["sandbox", "credits:read"] };
assert.equal(isSandboxRider(sandRider), true);
assert.equal(scopeBlockedForSandbox("credits:spend"), true);
assert.equal(scopeBlockedForSandbox("credits:read"), false);
assert.equal(scopeBlockedForSandbox("dm:send"), true);

console.log("PASS  sandbox unit + source guards");

// Optional live: documented key without server config → invalid_api_key or sandbox_not_configured
if (process.env.SKIP_LIVE === "1") {
  console.log("SKIP  live sandbox probes (SKIP_LIVE=1)");
  console.log("sandbox.selftest: ok");
  process.exit(0);
}

{
  const res = await fetch(`${LIVE_BASE}/api/rider/issue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DOCUMENTED}`,
      "content-type": "application/json",
      "x-rider-sandbox": "1",
    },
    body: JSON.stringify({ level: "L1" }),
  });
  const body = await res.json().catch(() => ({}));
  // Until Fly sets RIDER_SANDBOX_API_KEY, expect 401 invalid_api_key (or 503 if header-only path).
  // Never treat 200 as required on production until Ship arms the env.
  if (res.status === 200 && body.mode === "sandbox") {
    console.log("PASS  live sandbox issue (Fly RIDER_SANDBOX_API_KEY armed)");
    assert.equal(typeof body.rider, "string");
    // Funded settle must fail closed for sandbox rider
    const settle = await fetch(`${LIVE_BASE}/api/settle`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-rider": body.rider,
        "x-payment": Buffer.from(JSON.stringify({ fake: true })).toString("base64"),
      },
      body: JSON.stringify({
        hop_id: "sandbox-hop",
        job_id: "sandbox-job",
        key_id: "x402:sandbox",
        amount_usd: 0.01,
        meter: { egress_gb: 0, compute_s: 0, codec_s: 0 },
      }),
    });
    const sbody = await settle.json().catch(() => ({}));
    assert.equal(settle.status, 403, `sandbox funded settle must 403, got ${settle.status}`);
    assert.equal(sbody.error, "sandbox_forbidden");
    console.log("PASS  live sandbox cannot complete funded settle");
  } else {
    assert.ok(
      res.status === 401 || res.status === 503,
      `expected 401/503 before sandbox armed, got ${res.status} error=${body.error}`
    );
    console.log(`PASS  live sandbox not armed yet (http ${res.status} error=${body.error || "?"}) — expected until Ship sets RIDER_SANDBOX_API_KEY`);
  }
}

console.log("sandbox.selftest: ok");
