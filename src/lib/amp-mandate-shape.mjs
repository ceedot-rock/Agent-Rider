/**
 * Offline AMP SD-JWT L1/L2/L3 shape expectations.
 *
 * Source of truth (public): ant-intl/AMP `src/python/mandate_chain/`
 *   - generator.py (create_layer1/2/3, create_alipayplus_layer1,
 *     create_immediate_layer2, create_autonomous_layer2, create_checkout_layer3)
 *   - validator.py (verify_credential_chain, verify_agent_chain)
 *
 * This module documents Host-side shape checks only. It does NOT implement
 * live AMP settle, does NOT call Alipay+, and does NOT claim certification.
 * Live hop debit remains XPay — see docs/AMP_MILESTONE.md.
 */

import { createHash } from "node:crypto";

/** Upstream typ for all AMP mandate layers (RFC 9901 SD-JWT). */
export const AMP_SD_JWT_TYP = "sd+jwt";

/** Upstream signing alg for AMP mandate layers. */
export const AMP_ALG = "ES256";

/**
 * Layer roles (assurance L1–L3). Do NOT equate with Rider clearance L0–L4.
 */
export const LAYER_ROLES = Object.freeze({
  L1: "Issued by A+ (Alipay+); binds ISP public key via cnf.jwk; no _sd",
  L2: "Issued by ISP; binds to L1 via sd_hash; IMMEDIATE or AUTONOMOUS",
  L3: "Issued by Agent (AUTONOMOUS only); binds to L2 via sd_hash",
});

/** Visible (non-SD) claims expected on each layer shape. */
export const LAYER_VISIBLE = Object.freeze({
  L1: ["iss", "sub", "iat", "exp", "cnf", "isp_type", "isp_name"],
  L2_IMMEDIATE: ["nonce", "aud", "iat", "exp", "sd_hash", "idv_result", "idv_time", "mode"],
  L2_AUTONOMOUS: [
    "nonce",
    "aud",
    "iat",
    "exp",
    "sd_hash",
    "idv_result",
    "idv_time",
    "mode",
    "cnf",
  ],
  L3: ["nonce", "aud", "iat", "exp", "sd_hash"],
});

/** Selectively disclosable claim keys per layer (upstream generator). */
export const LAYER_SD = Object.freeze({
  L1: [], // MUST NOT have _sd / disclosures
  L2: ["intent", "token_info", "mandate_info", "checkout"],
  L2_AUTONOMOUS: ["intent", "token_info", "mandate_info"], // no checkout on L2; on L3
  L3: ["checkout"],
});

export const MODES = Object.freeze({
  IMMEDIATE: "IMMEDIATE",
  AUTONOMOUS: "AUTONOMOUS",
});

/**
 * B64URL(SHA-256(utf8(prevSerialized))) — mirrors AMP compute_sd_hash.
 * Used only for offline fixture binding checks.
 */
export function computeSdHash(prevSerialized) {
  const digest = createHash("sha256").update(String(prevSerialized), "utf8").digest();
  return digest.toString("base64url");
}

export function verifySdHashBinding(currentPayload, prevSerialized) {
  const expected = computeSdHash(prevSerialized);
  return currentPayload?.sd_hash === expected;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function requireKeys(obj, keys, label) {
  const missing = keys.filter((k) => !hasOwn(obj, k));
  if (missing.length) {
    throw new Error(`${label}: missing keys ${missing.join(", ")}`);
  }
}

/**
 * Validate an offline fixture object describing one layer's *decoded* shape.
 * Does not verify cryptographic signatures (no jwcrypto) — shape only.
 */
export function assertL1Shape(payload) {
  requireKeys(payload, LAYER_VISIBLE.L1, "L1");
  if (!payload.cnf || typeof payload.cnf !== "object" || !payload.cnf.jwk) {
    throw new Error("L1: cnf.jwk required (ISP public key binding)");
  }
  if (payload._sd || payload._sd_alg) {
    throw new Error("L1: MUST NOT carry _sd / _sd_alg");
  }
  return true;
}

export function assertL2Shape(payload, { mode } = {}) {
  const m = mode || payload.mode;
  if (m !== MODES.IMMEDIATE && m !== MODES.AUTONOMOUS) {
    throw new Error(`L2: mode must be IMMEDIATE or AUTONOMOUS, got ${m}`);
  }
  const keys = m === MODES.AUTONOMOUS ? LAYER_VISIBLE.L2_AUTONOMOUS : LAYER_VISIBLE.L2_IMMEDIATE;
  requireKeys(payload, keys, `L2(${m})`);
  if (!payload.sd_hash || typeof payload.sd_hash !== "string") {
    throw new Error("L2: sd_hash required (binds to L1)");
  }
  if (m === MODES.IMMEDIATE && hasOwn(payload, "cnf")) {
    throw new Error("L2 IMMEDIATE: MUST NOT carry cnf (no agent delegation)");
  }
  if (m === MODES.AUTONOMOUS) {
    if (!payload.cnf?.jwk) {
      throw new Error("L2 AUTONOMOUS: cnf.jwk required (agent key for L3)");
    }
  }
  return true;
}

export function assertL3Shape(payload) {
  requireKeys(payload, LAYER_VISIBLE.L3, "L3");
  if (!payload.sd_hash || typeof payload.sd_hash !== "string") {
    throw new Error("L3: sd_hash required (binds to L2)");
  }
  if (hasOwn(payload, "cnf")) {
    throw new Error("L3: MUST NOT carry cnf (terminal hop)");
  }
  return true;
}

/**
 * Minimal offline fixtures — synthetic payloads, not real AMP credentials.
 * Used by CI selftest only.
 */
export function buildOfflineFixtures() {
  const l1Serialized = "fixture.l1.jwt~";
  const l1 = {
    iss: "alipayplus.com",
    sub: "fixture-user",
    iat: 1_700_000_000,
    exp: 1_731_568_000,
    cnf: { jwk: { kty: "EC", crv: "P-256", x: "x", y: "y", kid: "isp-1" } },
    isp_type: "MPP",
    isp_name: "FIXTURE_WALLET",
  };

  const l2Immediate = {
    nonce: "n1",
    aud: "fixture-verifier",
    iat: 1_700_000_100,
    exp: 1_700_000_700,
    sd_hash: computeSdHash(l1Serialized),
    idv_result: "true",
    idv_time: "2026-09-19T00:00:00Z",
    mode: MODES.IMMEDIATE,
  };

  const l2Serialized = "fixture.l2.autonomous.jwt~disc~";
  const l2Autonomous = {
    nonce: "n2",
    aud: "fixture-verifier",
    iat: 1_700_000_100,
    exp: 1_700_086_400,
    sd_hash: computeSdHash(l1Serialized),
    idv_result: "true",
    idv_time: "2026-09-19T00:00:00Z",
    mode: MODES.AUTONOMOUS,
    cnf: { jwk: { kty: "EC", crv: "P-256", x: "ax", y: "ay", kid: "agent-1" } },
  };

  const l3 = {
    nonce: "n3",
    aud: "fixture-merchant",
    iat: 1_700_000_200,
    exp: 1_700_000_500,
    sd_hash: computeSdHash(l2Serialized),
  };

  return { l1Serialized, l1, l2Immediate, l2Serialized, l2Autonomous, l3 };
}

/** Host honesty flags — AMP settle is not live. */
export const HOST_HONESTY = Object.freeze({
  amp_settle_live: false,
  hop_default: "XPay",
  rider_clearance_vs_amp_assurance: "Rider L0–L4 ≠ AMP assurance L1–L3",
  signed_neq_kyc: true,
  milestone_doc: "docs/AMP_MILESTONE.md",
  upstream: "https://github.com/ant-intl/AMP/tree/main/src/python/mandate_chain",
});
