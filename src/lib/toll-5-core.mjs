/**
 * Toll 5 — verification oracle / exactness attestations: pure logic core.
 * Selftest-importable. TypeScript routes import this .mjs directly
 * (same pattern as toll-3-core.mjs).
 *
 * Faithful port of ~/workspace/rider-toll/tollkeeper/oracle.py (module D):
 *   submit {artifact, claim} -> run the exactness check -> return a sealed
 *   attestation payload consumable by the bonding/slash layer.
 *
 * The exactness function is PLUGGABLE. Interface:
 *   fn(artifact: dict, claim: dict) -> {
 *     "result": "pass" | "refuse",   # machine-readable
 *     "seats": [str, ...],           # seats the check ran on
 *     "detail": {...},               # diagnostic payload
 *   }
 * The default is a stub that byte-compares the claimed stdout against a
 * simulated stdout on two seats (same-stdout-or-refuse).
 *
 * A "refuse" result is a SUCCESSFUL check with a negative outcome —
 * it is never raised as an error.
 *
 * Money: integer micro-USDC only. 10c = 100_000. No float arithmetic.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./toll-receipt-core.mjs";

export class OracleError extends Error {}

/** 10c per check, in integer micro-USDC. */
export const CHECK_TOLL_UUSDC = 100_000;

/** Machine-readable policy reference consumed by slash conditions. */
export const POLICY_REF = "tollkeeper.oracle.exactness/v1";
export const ORACLE_ID = "tollkeeper-oracle/v1";

/** Seats the default stub simulates. */
export const DEFAULT_SEATS = ["seat-a", "seat-b"];

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Deterministic simulated stdout for a seat (stub only).
 * The seat id is deliberately NOT part of the hash: every seat runs the
 * same artifact, so every seat must produce the same stdout. (The real
 * CuNi gate gets genuine cross-seat divergence from running different
 * language seats.)
 */
function simulateSeatStdout(artifact, seat) {
  void seat;
  return sha256Hex(canonicalJson({ artifact }));
}

/** Content hash identifying the artifact (query key). */
export function artifactHashOf(artifact) {
  if (!isPlainObject(artifact)) throw new OracleError("artifact must be a dict");
  return sha256Hex(canonicalJson(artifact));
}

/**
 * Stub exactness: byte-compare claimed stdout vs simulated stdout on two
 * seats. Pass only if every seat's stdout matches the claim
 * (same-stdout-or-refuse). Throws OracleError on malformed input.
 */
export function defaultExactness(artifact, claim) {
  if (!isPlainObject(artifact)) throw new OracleError("artifact must be a dict");
  if (!isPlainObject(claim) || typeof claim.stdout !== "string")
    throw new OracleError("claim must be a dict with a string 'stdout'");
  const perSeat = {};
  for (const s of DEFAULT_SEATS) perSeat[s] = simulateSeatStdout(artifact, s);
  const seatsAgree = new Set(Object.values(perSeat)).size === 1;
  const match =
    seatsAgree && Object.values(perSeat).every((out) => out === claim.stdout);
  return {
    result: match ? "pass" : "refuse",
    seats: [...DEFAULT_SEATS],
    detail: {
      per_seat_stdout: perSeat,
      claim_stdout: claim.stdout,
      seats_agree: seatsAgree,
    },
  };
}

/** Validate an exactness function's output. Throws OracleError on contract breach. */
export function validateCheckResult(res) {
  if (!isPlainObject(res)) throw new OracleError("exactness_fn must return a dict");
  if (res.result !== "pass" && res.result !== "refuse")
    throw new OracleError("exactness_fn result must be 'pass' or 'refuse'");
  if (!Array.isArray(res.seats) || res.seats.length === 0)
    throw new OracleError("exactness_fn must return a non-empty seats list");
  if (!("detail" in res))
    throw new OracleError("exactness_fn must return a detail payload");
  return res;
}

/**
 * Build the unsigned attestation payload for a completed check.
 * attestation_id is deterministic: "at_" + sha256(canonical(core))[:16].
 * Returns { attestation_id, payload } — the caller signs payload.
 */
export function buildAttestationPayload({ artifact, claim, checkResult, checked_at }) {
  if (!Number.isInteger(checked_at))
    throw new OracleError("checked_at must be an integer unix time");
  const core = {
    artifact_hash: artifactHashOf(artifact),
    claim,
    result: checkResult.result,
    seats: checkResult.seats,
    checked_at,
  };
  const attestation_id = "at_" + sha256Hex(canonicalJson(core)).slice(0, 16);
  return {
    attestation_id,
    payload: {
      type: "exactness-attestation",
      version: 1,
      attestation_id,
      policy_ref: POLICY_REF,
      oracle: ORACLE_ID,
      ...core,
    },
  };
}
