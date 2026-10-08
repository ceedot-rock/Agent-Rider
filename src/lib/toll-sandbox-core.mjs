/**
 * Toll-gate corruption sandbox — pure decision engine.
 *
 * "Let me break a field in staging and watch the gate refuse dispatch."
 *
 * This module runs the EXACT validation pipelines of the live toll routes
 * (envelope signature verification, grant policy, exactness checks) but
 * performs ZERO side effects: no DB writes, no attestation signing, no
 * metering, no settlement, no charge. It is pure: every DB-dependent input
 * (revocation state, spend totals) is injected by the caller — the Next.js
 * route performs read-only lookups; tests inject fixtures.
 *
 * No Next.js, no DB, no network, no signing key. Selftest-importable.
 * Run: cd src && npm run selftest:toll-sandbox
 */

import { verifyTollEnvelope } from "./toll-receipt-core.mjs";
import { checkGrantPure, DEFAULT_REVOCATION_MAX_AGE } from "./toll-4-core.mjs";
import {
  OracleError,
  defaultExactness,
  validateCheckResult,
} from "./toll-5-core.mjs";

/** The public demo credential. Documented in SANDBOX.md. It authorizes
 *  NOTHING real — presenting it routes the request into the sandbox
 *  handler, which can never mint an attestation or touch state. */
export const DEFAULT_SANDBOX_DEMO_KEY = "sk_sandbox_demo";

export function sandboxDemoKey() {
  return process.env.TOLL_SANDBOX_DEMO_KEY ?? DEFAULT_SANDBOX_DEMO_KEY;
}

/**
 * True iff the presented credential is the public demo key.
 * Fail-safe: if an operator misconfigures TOLL_SANDBOX_DEMO_KEY to look like
 * a real billing key (ar_…), it is NOT treated as sandbox — it falls through
 * to normal auth and fails there unless genuinely valid.
 */
export function isSandboxCredential(bearerToken, merchantKey) {
  const k = sandboxDemoKey();
  if (!k || typeof k !== "string" || k.startsWith("ar_")) return false;
  return bearerToken === k || merchantKey === k;
}

/**
 * Map a toll-receipt envelope verification failure to a refusal code.
 * The live v4 route collapses every envelope failure to "bad_signature";
 * the sandbox refines the code so a researcher can see WHICH check fired.
 * Same failure, more precise label — never a different verdict.
 */
export function classifyEnvelopeError(message) {
  const m = String(message ?? "");
  if (/unknown kid/i.test(m)) return "unknown_kid";
  if (
    /envelope must be a dict/i.test(m) ||
    /missing field/i.test(m) ||
    /envelope payload must be/i.test(m) ||
    /kid must be a non-empty string/i.test(m) ||
    /base64url decode failed/i.test(m) ||
    /bad signature length/i.test(m)
  )
    return "malformed_envelope";
  return "bad_signature";
}

function isInt(v) {
  return typeof v === "number" && Number.isInteger(v);
}

// ── v4: delegation-grant check ──────────────────────────────────────────
// Split into two pure phases so the route can interleave its read-only DB
// lookups (revocation, spends) exactly where the live route does them.

/**
 * Phase 1 — input shape + envelope signature. No DB.
 * Returns { decision, refusal_code, checks_run, http_status, payload? }.
 * payload is present only when decision is still undecided (signature ok).
 */
export function sandboxV4Verify({
  grant_envelope,
  jwks,
  action,
  amount_uusdc,
  revocationCheckedAt = null,
}) {
  const checks_run = ["input_shape"];
  if (!jwks || typeof jwks !== "object")
    return {
      decision: "refuse",
      refusal_code: "missing_jwks",
      checks_run,
      http_status: 400,
    };
  if (typeof action !== "string" || !action)
    return {
      decision: "refuse",
      refusal_code: "bad_action",
      checks_run,
      http_status: 400,
    };
  if (typeof amount_uusdc === "boolean" || !isInt(amount_uusdc) || amount_uusdc < 0)
    return {
      decision: "refuse",
      refusal_code: "bad_amount_uusdc",
      checks_run,
      http_status: 400,
    };
  if (
    revocationCheckedAt !== null &&
    revocationCheckedAt !== undefined &&
    !isInt(revocationCheckedAt)
  )
    return {
      decision: "refuse",
      refusal_code: "bad_revocation_checked_at",
      checks_run,
      http_status: 400,
    };

  checks_run.push("envelope_signature");
  let payload;
  try {
    payload = verifyTollEnvelope(grant_envelope, jwks);
  } catch (err) {
    return {
      decision: "refuse",
      refusal_code: classifyEnvelopeError(err && err.message),
      checks_run,
      http_status: 200,
    };
  }
  return {
    decision: "undecided",
    refusal_code: null,
    checks_run,
    http_status: 200,
    payload,
  };
}

/**
 * Phase 2 — pure grant policy (checkGrantPure). The caller supplies the
 * read-only lookup results: revoked (bool) and spentTotal (int).
 */
export function sandboxV4Policy({
  payload,
  action,
  amount_uusdc,
  revocationCheckedAt = null,
  now,
  revoked,
  spentTotal,
  checks_run: priorChecks = [],
}) {
  const checks_run = [...priorChecks, "revocation_lookup", "spend_lookup", "grant_policy"];
  const decision = checkGrantPure({
    grantPayload: payload,
    action,
    amount_uusdc,
    now,
    revoked,
    revocationCheckedAt: revocationCheckedAt === undefined ? null : revocationCheckedAt,
    maxAge: DEFAULT_REVOCATION_MAX_AGE,
    spentTotal,
  });
  return {
    decision: decision.allowed ? "allow" : "refuse",
    refusal_code: decision.allowed ? null : decision.reason,
    checks_run,
    http_status: 200,
    grant_id:
      payload && typeof payload.grant_id === "string" ? payload.grant_id : "unknown",
  };
}

// ── v5: exactness check ─────────────────────────────────────────────────
// Fully pure — no DB reads in the live pipeline either.

export function sandboxV5Decide({ artifact, claim }) {
  const checks_run = ["request_shape"];
  let checkResult;
  try {
    checkResult = validateCheckResult(defaultExactness(artifact, claim));
  } catch (err) {
    if (err instanceof OracleError)
      return {
        decision: "refuse",
        refusal_code: "malformed_check_request",
        reason: err.message,
        checks_run,
        http_status: 400,
      };
    throw err; // fail closed: unexpected errors never become "allow"
  }
  checks_run.push("exactness_check");
  if (checkResult.result === "pass")
    return {
      decision: "allow",
      refusal_code: null,
      checks_run,
      http_status: 200,
      detail: checkResult.detail,
    };
  return {
    decision: "refuse",
    refusal_code: "exactness_refuse",
    checks_run,
    http_status: 200,
    detail: checkResult.detail,
  };
}

// ── v1: rider-JWT verify ────────────────────────────────────────────────
// The route performs verifyRider(token) (pure JWT check, no DB) and injects
// the result; this maps it to the sandbox verdict. Same reason strings as live.

export function sandboxV1Decide({ token, verifyResult }) {
  const checks_run = ["jwt_verify"];
  if (!token || typeof token !== "string")
    return {
      decision: "refuse",
      refusal_code: "missing_rider",
      checks_run,
      http_status: 400,
    };
  if (!verifyResult || verifyResult.valid !== true)
    return {
      decision: "refuse",
      refusal_code:
        (verifyResult && verifyResult.reason) || "invalid_token",
      checks_run,
      http_status: 200,
    };
  return {
    decision: "allow",
    refusal_code: null,
    checks_run,
    http_status: 200,
  };
}
