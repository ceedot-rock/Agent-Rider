/**
 * Toll 4 — delegation grants (Warrant-compatible scoped authority): pure core.
 *
 * Port of ~/workspace/rider-toll/tollkeeper/grants.py. A grant is a signed
 * envelope:
 *   {grantor, agent_id, scope: [actions], cap_uusdc, not_before, not_after,
 *    revocable: true, ...}
 *
 * Money rule: all amounts are integer micro-USDC (uusdc). 1c = 10_000,
 * half a cent = 5_000. No float arithmetic on money anywhere in this file.
 *
 * Tolls: 1c per issuance (ISSUE_TOLL_UUSDC), half a cent per check
 * (CHECK_TOLL_UUSDC).
 *
 * Fail-closed revocation: every check consults the revocation list. A caller
 * may pass a cached revocationCheckedAt timestamp; if that check is older
 * than maxAge (default 300 s) the grant is refused with
 * "revocation_check_stale". The default path does a live lookup, which is
 * always fresh (routes pass revocationCheckedAt = now after a live read).
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./toll-receipt-core.mjs";

/** 1c issuance toll, integer micro-USDC. */
export const ISSUE_TOLL_UUSDC = 10_000;
/** Half-cent check toll, integer micro-USDC. */
export const CHECK_TOLL_UUSDC = 5_000;
/** Revocation check older than this (seconds) is stale -> refuse (fail closed). */
export const DEFAULT_REVOCATION_MAX_AGE = 300;

const GRANT_FIELDS = [
  "grant_id",
  "grantor",
  "agent_id",
  "scope",
  "cap_uusdc",
  "not_before",
  "not_after",
  "revocable",
  "issued_at",
];

/** Raised for malformed grant requests (not for check refusals). */
export class Toll4GrantError extends Error {}

/**
 * Convert a USDC amount to integer micro-USDC.
 * Accepts an int or an integer-numeric string only; bool, floats,
 * non-numeric strings, and negatives are refused.
 * DEVIATION from Python usdc_to_uusdc (documented): Python also accepted
 * Decimal and fractional strings (e.g. one two-hundredth of a USDC)
 * via Decimal(str(amount)).
 * The JS port refuses them — floats never touch money.
 */
export function usdcToUusdc(amount) {
  if (typeof amount === "boolean")
    throw new Toll4GrantError("amount must not be a bool");
  if (typeof amount === "number") {
    if (!Number.isInteger(amount))
      throw new Toll4GrantError("float amounts refused; use integer micro-USDC");
    if (amount < 0) throw new Toll4GrantError("amount must be >= 0");
    return amount * 1_000_000;
  }
  if (typeof amount === "string") {
    if (!/^[0-9]+$/.test(amount.trim()))
      throw new Toll4GrantError("amount must be an int or integer-numeric string");
    return Number(amount.trim()) * 1_000_000;
  }
  throw new Toll4GrantError("amount must be an int or integer-numeric string");
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isInt(v) {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * Deterministic grant id: "gr_" + first 16 hex chars of
 * sha256(canonicalJson(core)) — byte-identical to Python's
 * "gr_" + sha256(canonical(core)).hexdigest()[:16].
 */
export function grantIdFor(core) {
  const digest = createHash("sha256")
    .update(canonicalJson(core), "utf8")
    .digest("hex");
  return "gr_" + digest.slice(0, 16);
}

/**
 * Build an unsigned grant payload. Validates every input fail-closed.
 * Caller signs with signTollPayload (routes sign with the lab key as issuer).
 * Returns {grant_id, payload}.
 */
export function buildGrantPayload({
  grantor,
  agent_id,
  scope,
  cap_uusdc,
  not_before,
  not_after,
  revocable = true,
  issued_at,
}) {
  if (!isNonEmptyString(grantor))
    throw new Toll4GrantError("grantor must be a non-empty string");
  if (!isNonEmptyString(agent_id))
    throw new Toll4GrantError("agent_id must be a non-empty string");
  if (
    !Array.isArray(scope) ||
    scope.length === 0 ||
    !scope.every((a) => isNonEmptyString(a))
  )
    throw new Toll4GrantError("scope must be a non-empty list of action strings");
  if (!isInt(cap_uusdc) || cap_uusdc <= 0)
    throw new Toll4GrantError("cap_uusdc must be a positive integer (micro-USDC)");
  if (!isInt(not_before) || !isInt(not_after))
    throw new Toll4GrantError("not_before/not_after must be integer epoch seconds");
  if (not_after <= not_before)
    throw new Toll4GrantError("not_after must be after not_before");
  const now = issued_at === undefined ? Math.floor(Date.now() / 1000) : issued_at;
  if (!isInt(now)) throw new Toll4GrantError("issued_at must be an integer");

  const core = {
    grantor,
    agent_id,
    scope: [...scope],
    cap_uusdc,
    not_before,
    not_after,
    issued_at: now,
  };
  const payload = {
    type: "delegation-grant",
    version: 1,
    grant_id: grantIdFor(core),
    revocable: Boolean(revocable),
    ...core,
  };
  return { grant_id: payload.grant_id, payload };
}

/**
 * Build an unsigned grant-revocation payload. The revocation is itself a
 * signed envelope. No toll.
 */
export function buildRevocationPayload({ grant_id, revoker, revoked_at }) {
  if (!isNonEmptyString(grant_id))
    throw new Toll4GrantError("grant_id must be a non-empty string");
  if (!isNonEmptyString(revoker))
    throw new Toll4GrantError("revoker must be a non-empty string");
  const now = revoked_at === undefined ? Math.floor(Date.now() / 1000) : revoked_at;
  if (!isInt(now)) throw new Toll4GrantError("revoked_at must be an integer");
  return {
    type: "grant-revocation",
    version: 1,
    grant_id,
    revoker,
    revoked_at: now,
  };
}

/**
 * Pure grant check. The caller verifies the envelope signature first:
 * "bad_signature" is reported by the caller when verifyTollEnvelope throws.
 *
 * Returns {allowed, reason}. Reasons, in the same order as Python's
 * check_grant: ok | malformed_grant | not_yet_valid | expired |
 * revocation_check_stale | revoked | scope_miss | cap_exceeded.
 *
 * @param grantPayload verified payload dict (caller already verified sig)
 * @param action action string being authorized
 * @param amount_uusdc integer micro-USDC >= 0
 * @param now integer epoch seconds
 * @param revoked whether grant_id is on the revocation list
 * @param revocationCheckedAt epoch of the last live revocation read, or null
 *        for "checked just now"
 * @param maxAge max seconds a revocation check may be old (default 300)
 * @param spentTotal integer micro-USDC already spent under this grant
 */
export function checkGrantPure({
  grantPayload,
  action,
  amount_uusdc,
  now,
  revoked,
  revocationCheckedAt = null,
  maxAge = DEFAULT_REVOCATION_MAX_AGE,
  spentTotal,
}) {
  const p = grantPayload;
  const malformed = () => ({ allowed: false, reason: "malformed_grant" });

  if (!p || typeof p !== "object" || Array.isArray(p)) return malformed();
  if (p.type !== "delegation-grant") return malformed();
  for (const f of GRANT_FIELDS) {
    if (!(f in p)) return malformed();
  }
  if (typeof amount_uusdc === "boolean" || !isInt(amount_uusdc) || amount_uusdc < 0)
    return malformed();

  if (now < p.not_before) return { allowed: false, reason: "not_yet_valid" };
  if (now > p.not_after) return { allowed: false, reason: "expired" };

  // Fail closed on revocation freshness.
  const checkedAt = revocationCheckedAt === null ? now : revocationCheckedAt;
  if (now - checkedAt > maxAge)
    return { allowed: false, reason: "revocation_check_stale" };
  if (revoked) return { allowed: false, reason: "revoked" };

  if (!Array.isArray(p.scope) || !p.scope.includes(action))
    return { allowed: false, reason: "scope_miss" };

  if (!isInt(p.cap_uusdc) || typeof spentTotal !== "number" || !isInt(spentTotal))
    return malformed();
  if (spentTotal + amount_uusdc > p.cap_uusdc)
    return { allowed: false, reason: "cap_exceeded" };

  return { allowed: true, reason: "ok" };
}
