#!/usr/bin/env node
/**
 * Agent Rider — one-file quickstart (dry path).
 *
 *   cd packages/agent-rider-quickstart && npm install && node quickstart.mjs
 *
 * 1) Mint a signed rider (sandbox key OR ephemeral register)
 * 2) Verify via JWKS (ES256) + POST /api/rider/verify
 * 3) Print { ok: true, receipt… }
 *
 * No Fly login. No wallet. Funded USDC settle is optional elsewhere (SETTLE_FUNDED).
 * Cash face: https://www.slidphilabs.com/pcc — Rider is not the cash door.
 *
 * Env (optional):
 *   LIVE_BASE              default https://agentrider.fly.dev
 *   RIDER_SANDBOX_KEY      public sandbox key (server must set RIDER_SANDBOX_API_KEY)
 *   SKIP_REGISTER=1        do not fall back to ephemeral register if sandbox fails
 */
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";

const LIVE_BASE = (process.env.LIVE_BASE || "https://agentrider.fly.dev").replace(/\/+$/, "");
const DOCUMENTED_SANDBOX_KEY = "ar_sandbox_demo";
const CASH_FACE = "https://www.slidphilabs.com/pcc";
const ISSUER = "agentrider.dev";

function redact(s) {
  if (!s || typeof s !== "string") return "";
  if (s.length <= 12) return "(redacted)";
  return `${s.slice(0, 8)}…(len=${s.length})`;
}

async function postJson(path, { headers = {}, body } = {}) {
  const res = await fetch(`${LIVE_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function trySandboxIssue(sandboxKey) {
  const { status, json } = await postJson("/api/rider/issue", {
    headers: {
      authorization: `Bearer ${sandboxKey}`,
      "x-rider-sandbox": "1",
    },
    body: { level: "L1", scopes: ["sandbox"] },
  });
  if (status === 200 && typeof json.rider === "string") {
    return { mode: "sandbox", rider: json.rider, jti: json.jti, expires_in: json.expires_in };
  }
  return { mode: "sandbox", error: json.error || `http_${status}`, status };
}

async function ephemeralIssue() {
  const name = `quickstart-${Date.now().toString(36)}`;
  const reg = await postJson("/api/agents", {
    body: { name, type: "agent", operator_id: "quickstart", provenance: "smoke" },
  });
  if (reg.status !== 200 && reg.status !== 201) {
    throw new Error(`register_failed http_${reg.status} ${reg.json.error || ""}`);
  }
  const apiKey = reg.json.api_key;
  if (typeof apiKey !== "string" || !apiKey.startsWith("ar_")) {
    throw new Error("register_missing_api_key");
  }
  const issue = await postJson("/api/rider/issue", {
    headers: { authorization: `Bearer ${apiKey}` },
    body: { level: "L1", scopes: ["*"] },
  });
  if (issue.status !== 200 || typeof issue.json.rider !== "string") {
    throw new Error(`issue_failed http_${issue.status} ${issue.json.error || ""}`);
  }
  return {
    mode: "ephemeral",
    rider: issue.json.rider,
    jti: issue.json.jti,
    expires_in: issue.json.expires_in,
    agent_id: reg.json.agent_id,
    api_key_redacted: redact(apiKey),
  };
}

async function verifyLocalJwks(token) {
  const JWKS = createRemoteJWKSet(new URL(`${LIVE_BASE}/.well-known/jwks.json`));
  const header = decodeProtectedHeader(token);
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, algorithms: ["ES256"] });
  return { header, payload };
}

async function verifyRemote(token) {
  const { status, json } = await postJson("/api/rider/verify", {
    body: { rider: token },
  });
  return { status, json };
}

async function main() {
  console.log("Agent Rider quickstart (dry)");
  console.log(`  base: ${LIVE_BASE}`);
  console.log(`  cash_face: ${CASH_FACE} (Rider is not the cash door)`);

  const sandboxKey = process.env.RIDER_SANDBOX_KEY || DOCUMENTED_SANDBOX_KEY;
  let minted = null;

  const sandboxTry = await trySandboxIssue(sandboxKey);
  if (sandboxTry.rider) {
    minted = sandboxTry;
    console.log(`  auth: sandbox (${redact(sandboxKey)})`);
  } else {
    console.log(
      `  auth: sandbox unavailable (${sandboxTry.error || "n/a"}) — falling back to ephemeral register`
    );
    if (process.env.SKIP_REGISTER === "1") {
      throw new Error("sandbox_unavailable_and_SKIP_REGISTER=1");
    }
    minted = await ephemeralIssue();
    console.log(`  auth: ephemeral agent_id=${minted.agent_id} key=${minted.api_key_redacted}`);
  }

  const local = await verifyLocalJwks(minted.rider);
  const remote = await verifyRemote(minted.rider);
  const remoteOk = remote.status === 200 && remote.json.valid === true;
  const sandboxClaim = local.payload.sandbox === true || local.payload.agent_id === "rider-sandbox";

  const receipt = {
    ok: true,
    mode: minted.mode,
    verified: {
      jwks_es256: true,
      api_rider_verify: remoteOk,
      kid: local.header.kid,
      alg: local.header.alg,
      iss: local.payload.iss,
      agent_id: local.payload.agent_id,
      level: local.payload.level,
      sandbox: sandboxClaim,
      jti: local.payload.jti,
      exp: local.payload.exp,
    },
    expires_in: minted.expires_in,
    cash_face: CASH_FACE,
    next: {
      mcp: `${LIVE_BASE}/api/mcp`,
      flip_to_paid:
        "Vault a real ar_ from POST /api/agents (or MCP register), then POST /api/rider/issue. Optional funded hop: docs/SETTLE_SMOKE.md (SETTLE_FUNDED) — cash CTA remains /pcc.",
      docs: "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/QUICKSTART.md",
    },
  };

  if (!remoteOk) {
    receipt.ok = false;
    receipt.error = "remote_verify_failed";
    console.log(JSON.stringify(receipt, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message || err), cash_face: CASH_FACE }, null, 2));
  process.exit(1);
});
