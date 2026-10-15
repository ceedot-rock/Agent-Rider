/**
 * Rider public attestation — no-account path: pure core.
 *
 * POST /api/toll/public/attest. No auth, no account, no billing.
 * Two shapes:
 *   {"payload": {...}}            -> notarization: "the lab saw this exact
 *                                          payload at time T"
 *   {"artifact": {...}, "claim"}  -> exactness: runs the same check as the
 *                                          v5 toll gate (defaultExactness),
 *                                          attests the result
 *
 * Returns the standard envelope {payload, sig, kid, alg:"ES256"} signed
 * with the lab key — verifiable offline against /.well-known/jwks.json.
 *
 * Abuse guards: 64KB body cap, floats refused (canonicalization throws),
 * per-IP fixed-window rate limit (in-process — no DB, no writes anywhere).
 *
 * This module performs ZERO side effects: no DB, no metering, no billing,
 * no settlement. Signing happens in the route via signTollPayload, which
 * throws (500) when the key is missing — fail closed, never unsigned.
 *
 * Selftest-importable. Run: cd src && npm run selftest:toll-public-attest
 */

import { createHash } from "node:crypto";
import {
  canonicalJson,
  TollReceiptError,
} from "./toll-receipt-core.mjs";
import {
  OracleError,
  artifactHashOf,
  defaultExactness,
  validateCheckResult,
} from "./toll-5-core.mjs";

/** 64KB raw-body cap for the public endpoint. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Issuer stamped on every public receipt. */
export const PUBLIC_ATTEST_ISSUER = "slid-phi-labs";

/** Receipt payload schema version (bump if fields change). */
export const PUBLIC_ATTEST_VERSION = 1;

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Byte-size guard for the raw request body. True when over the cap.
 * Uses byte length (not char length) so multibyte input can't smuggle past.
 */
export function isBodyTooLarge(rawText) {
  if (typeof rawText !== "string") return true;
  return Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES;
}

/**
 * Classify the request shape. Returns "notarization" | "exactness" |
 * "unknown". A body with BOTH payload and artifact/claim is unknown —
 * the caller must pick one shape.
 */
export function classifyAttestShape(body) {
  if (!isPlainObject(body)) return "unknown";
  const hasPayload = "payload" in body;
  const hasCheck = "artifact" in body && "claim" in body;
  if (hasPayload && !hasCheck) return "notarization";
  if (hasCheck && !hasPayload) return "exactness";
  return "unknown";
}

/**
 * Build the unsigned notarization receipt payload.
 * Attests: "the lab saw this exact payload at time T".
 * Throws TollReceiptError on floats (canonicalization refuses them).
 */
export function buildNotarizationPayload({ payload, attested_at }) {
  if (!isPlainObject(payload))
    throw new TollReceiptError("payload must be a dict");
  if (!Number.isInteger(attested_at))
    throw new TollReceiptError("attested_at must be an integer unix time");
  // canonicalJson throws TollReceiptError on floats — the refusal path.
  const payload_hash = sha256Hex(canonicalJson({ payload }));
  return {
    type: "public-attestation",
    version: PUBLIC_ATTEST_VERSION,
    mode: "notarization",
    issuer: PUBLIC_ATTEST_ISSUER,
    payload_hash,
    attested_at,
  };
}

/**
 * Run the v5 exactness pipeline (same code path as the live gate) and
 * build the unsigned receipt payload. Throws OracleError on malformed
 * input — same contract as the live route.
 */
export function buildExactnessAttestation({ artifact, claim, checked_at }) {
  const checkResult = validateCheckResult(defaultExactness(artifact, claim));
  if (!Number.isInteger(checked_at))
    throw new OracleError("checked_at must be an integer unix time");
  return {
    result: checkResult.result,
    payload: {
      type: "public-attestation",
      version: PUBLIC_ATTEST_VERSION,
      mode: "exactness",
      issuer: PUBLIC_ATTEST_ISSUER,
      artifact_hash: artifactHashOf(artifact),
      claim,
      result: checkResult.result,
      seats: checkResult.seats,
      checked_at,
    },
    detail: checkResult.detail,
  };
}

// ── in-process fixed-window rate limiter ────────────────────────────────
// No DB, no writes, no external failure mode — inherently fail-closed.
// (The DB-backed checkRateLimit fails OPEN on outage, which is the wrong
// posture for a free signing endpoint, so this endpoint does not use it.)

const buckets = new Map(); // ip -> { windowStartMs, count }
const WINDOW_MS = 3600 * 1000;

export function publicAttestMaxPerHour() {
  return Number(process.env.PUBLIC_ATTEST_MAX_PER_HOUR) || 60;
}

/**
 * Returns { ok, retryAfter } — retryAfter is seconds until the window
 * resets (0 when ok). Counts the current request against the window.
 */
export function checkPublicAttestLimit(ip) {
  const max = publicAttestMaxPerHour();
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.windowStartMs >= WINDOW_MS) {
    b = { windowStartMs: now, count: 0 };
    buckets.set(ip, b);
  }
  // Opportunistic prune so the map can't grow without bound.
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (now - v.windowStartMs >= WINDOW_MS) buckets.delete(k);
    }
  }
  b.count += 1;
  if (b.count > max) {
    return {
      ok: false,
      retryAfter: Math.max(
        1,
        Math.ceil((b.windowStartMs + WINDOW_MS - now) / 1000)
      ),
    };
  }
  return { ok: true, retryAfter: 0 };
}

/** Test-only: clear all buckets. */
export function __resetPublicAttestLimits() {
  buckets.clear();
}
