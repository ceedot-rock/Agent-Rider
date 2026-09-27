/**
 * Toll 6 — bonds: stake/slash/release + audit export (pure logic, dark).
 * Port of ~/workspace/rider-toll/tollkeeper/bonds.py (BondLedger logic minus
 * the SQLite store; state writes happen in the route via Supabase).
 *
 * Money: integer micro-USDC ("uusdc"). NEVER floats — canonicalJson refuses
 * non-integer numbers, so a float anywhere in a payload fails signing.
 *
 * Deviations from the Python spec (documented):
 *  - validateAmountUusdc accepts INTEGER micro-USDC only. Python's
 *    to_uusdc() accepted float USDC (e.g. 10.0 -> 10_000_000). We refuse
 *    floats outright: the API boundary speaks uusdc integers, never USDC
 *    floats, so no rounding can sneak in.
 *  - slash_pct must be an INTEGER 1..100. Python allowed float pct (e.g.
 *    2.5). Integer pct keeps every slash amount exact under integer division.
 */
import { randomBytes } from "node:crypto";

export class Toll6Error extends Error {}

/**
 * trigger -> [expected attestation_type, expected verdict/outcome]
 * Port of TRIGGER_ATTESTATION in bonds.py.
 */
export const TRIGGER_ATTESTATION = {
  dispute_upheld: ["dispute_resolution", "upheld"],
  oracle_refuse: ["exactness_attestation", "refuse"],
  oracle_fail: ["exactness_attestation", "fail"],
  timeout_default: ["timeout_certificate", "default"],
};

/** Default slash recipient when the evidence carries no pay_to. */
export const RECOURSE_POOL = "lab:recourse-pool";

/** Audit-trail export toll: 5c, metered (no real charge). */
export const AUDIT_EXPORT_FEE_UUSDC = 50_000;

/** ISO-8601 Zulu now, matching Python utcnow() ("%Y-%m-%dT%H:%M:%SZ"). */
export function utcnow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Integer micro-USDC > 0. Refuses bools, floats, non-numbers, <= 0.
 * (Deviation: Python to_uusdc accepted float USDC; we take uusdc ints only.)
 */
export function validateAmountUusdc(v) {
  if (typeof v === "boolean" || typeof v !== "number" || !Number.isInteger(v)) {
    throw new Toll6Error(
      `amount_uusdc must be an integer micro-USDC value, got ${typeof v === "number" ? v : typeof v}`
    );
  }
  if (v <= 0) throw new Toll6Error("bond amount must be > 0");
  return v;
}

/**
 * Validate the conditions list. Each entry: {on: known trigger,
 * slash_pct: integer 1..100}. Non-empty, no duplicate triggers. Returns the
 * list unchanged on success; throws Toll6Error otherwise (fail closed).
 * (Deviation: Python allowed float pct; we require integer pct.)
 */
export function validateConditions(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Toll6Error("conditions must be a non-empty list");
  }
  const seen = new Set();
  for (const c of conditions) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      throw new Toll6Error("each condition must be a dict");
    }
    const on = c.on;
    const pct = c.slash_pct;
    if (!(on in TRIGGER_ATTESTATION)) {
      throw new Toll6Error(
        `unknown trigger ${JSON.stringify(on)}; known: ${Object.keys(TRIGGER_ATTESTATION).sort().join(", ")}`
      );
    }
    if (seen.has(on)) throw new Toll6Error(`duplicate trigger ${JSON.stringify(on)}`);
    seen.add(on);
    if (typeof pct === "boolean" || typeof pct !== "number" || !Number.isInteger(pct)) {
      throw new Toll6Error("slash_pct must be an integer");
    }
    if (!(pct > 0 && pct <= 100)) {
      throw new Toll6Error("slash_pct must be in (0, 100]");
    }
  }
  return conditions;
}

/** Fresh bond id: "bnd_" + 16 hex chars (== secrets.token_hex(8)). */
export function newBondId() {
  return "bnd_" + randomBytes(8).toString("hex");
}

/** Stake toll: 1% of bonded value, integer division (amount // 100). */
export function stakeTollFor(amountUusdc) {
  return Math.floor(amountUusdc / 100);
}

export function buildStakePayload({ bond_id, agent_id, amount_uusdc, conditions, created_at }) {
  return {
    type: "bond_stake",
    bond_id,
    agent_id,
    amount_uusdc,
    conditions,
    created_at,
  };
}

/**
 * Check an ALREADY-VERIFIED evidence payload against a trigger:
 * payload.bond_id must match; payload.attestation_type and the verdict
 * (from `verdict` or `outcome`) must match TRIGGER_ATTESTATION[trigger].
 * Throws Toll6Error with a clear reason on mismatch; returns {verdict}.
 */
export function validateSlashEvidence(evidencePayload, bond_id, trigger) {
  if (typeof evidencePayload !== "object" || evidencePayload === null || Array.isArray(evidencePayload)) {
    throw new Toll6Error("evidence payload must be a dict");
  }
  if (evidencePayload.bond_id !== bond_id) {
    throw new Toll6Error(`evidence does not reference bond ${JSON.stringify(bond_id)}`);
  }
  if (!(trigger in TRIGGER_ATTESTATION)) {
    throw new Toll6Error(`unknown trigger ${JSON.stringify(trigger)}`);
  }
  const [wantType, wantVerdict] = TRIGGER_ATTESTATION[trigger];
  if (evidencePayload.attestation_type !== wantType) {
    throw new Toll6Error(
      `evidence attestation_type ${JSON.stringify(evidencePayload.attestation_type)} does not satisfy trigger ${JSON.stringify(trigger)} (want ${JSON.stringify(wantType)})`
    );
  }
  const verdict = evidencePayload.verdict ?? evidencePayload.outcome;
  if (verdict !== wantVerdict) {
    throw new Toll6Error(
      `evidence verdict ${JSON.stringify(verdict)} does not satisfy trigger ${JSON.stringify(trigger)} (want ${JSON.stringify(wantVerdict)})`
    );
  }
  return { verdict };
}

/**
 * Integer slash math: slashAmt = remaining*slash_pct//100.
 * Throws when nothing remains to slash (matches Python's "nothing left to slash").
 */
export function slashAmounts(remainingUusdc, slashPct) {
  const slashAmt = Math.floor((remainingUusdc * slashPct) / 100);
  if (slashAmt <= 0) throw new Toll6Error("nothing left to slash");
  const remaining = remainingUusdc - slashAmt;
  return {
    slashAmt,
    remaining,
    newStatus: remaining === 0 ? "exhausted" : "active",
  };
}

export function buildSlashPayload({
  bond_id, agent_id, trigger, slash_pct, slashed_uusdc,
  recipient, evidence_id, remaining_uusdc, created_at,
}) {
  return {
    type: "bond_slash",
    bond_id,
    agent_id,
    trigger,
    slash_pct,
    slashed_uusdc,
    recipient,
    evidence_id,
    remaining_uusdc,
    created_at,
  };
}

export function buildReleasePayload({ bond_id, agent_id, released_uusdc, created_at }) {
  return {
    type: "bond_release",
    bond_id,
    agent_id,
    released_uusdc,
    created_at,
  };
}

export function buildAuditTrailPayload({ agent_id, chain, exported_at }) {
  return {
    type: "audit_trail",
    agent_id,
    exported_at,
    envelope_count: chain.length,
    chain,
  };
}
