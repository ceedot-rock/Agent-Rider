/**
 * Sealed ride payload envelope — thin types + create/bind/verify (PARKED / not live).
 *
 * What a future sealed boundary packs for rider mint / settle-critical use.
 * RULES:
 * - Never embed or log ar_ values, RIDER_PRIVATE_KEY, JWTs, X-PAYMENT secrets.
 * - No key_material / api_key_plaintext fields on this type — ever.
 * - Attestation evidence is a detached slot (shape only until verify is live).
 * - Hop fund path remains Rider settle → XPay (not PCC). Signed rider ≠ KYC.
 *
 * Docs: docs/HOST_ATTESTATION.md
 */

import {
  redactForLog as redactForLogJs,
  serializeSealedRideEnvelope as serializeSealedRideEnvelopeJs,
  createSealedRide as createSealedRideJs,
  bindSealedRideSeat as bindSealedRideSeatJs,
  verifySealedRideForExecute as verifySealedRideForExecuteJs,
  isSealedRideRequired as isSealedRideRequiredJs,
  SEALED_RIDE_DOCS,
  isForbiddenEnvelopeFieldName,
} from "./sealed-ride-envelope.mjs";

/** Rider claims minted inside a sealed boundary (no private key fields). */
export type SealedRiderClaims = {
  sub: string;
  agent_id?: string;
  level: string;
  scopes: string[];
  jti: string;
  exp: number;
  iss: string;
};

/**
 * Detached attestation evidence slot — structure only until Nitro/SEV verify
 * ships. Do not put ar_ or signing keys here.
 */
export type SealedAttestationEvidenceSlot = {
  platform: "none" | "nitro" | "sev_snp" | "gcp_confidential";
  measurement: string | null;
  nonce: string | null;
  issued_at: string | null;
  /** Opaque platform quote bytes/doc — not live today. */
  evidence: unknown | null;
  verify?: {
    required?: boolean;
    result?: string;
  };
};

export type SealedRideSeat = {
  agent_id: string;
};

/**
 * Thin sealed ride envelope: packed artifacts + evidence slot.
 * Explicitly omits key material fields.
 */
export type SealedRideEnvelope = {
  /** Schema version for forward compatibility. */
  v: 1;
  /** Opaque ride id (not a secret). */
  ride_id?: string;
  /** What the sealed boundary is doing. */
  purpose: "rider_mint" | "settle_gate" | "sealed_preview" | "execute";
  /** Whether a seat has been bound. */
  seat_bound?: boolean;
  seat?: SealedRideSeat | null;
  /** Public rider claims (or draft) — never the signing private key. */
  rider_claims: SealedRiderClaims | null;
  /** API-key hash lookup result only — never ar_ plaintext. */
  api_key_hash_ok: boolean | null;
  agent_id: string | null;
  /** Detached attestation evidence slot (may be null while PARKED). */
  attestation: SealedAttestationEvidenceSlot | null;
  /** ISO time the envelope was packed (host clock). */
  packed_at: string | null;
  docs: typeof SEALED_RIDE_DOCS | string;
};

export const SEALED_RIDE_ENVELOPE_DOCS = SEALED_RIDE_DOCS;

/** Empty preview envelope — honesty: not live, no secrets. */
export const SEALED_RIDE_ENVELOPE_PREVIEW: SealedRideEnvelope = {
  v: 1,
  purpose: "sealed_preview",
  seat_bound: false,
  seat: null,
  rider_claims: null,
  api_key_hash_ok: null,
  agent_id: null,
  attestation: {
    platform: "none",
    measurement: null,
    nonce: null,
    issued_at: null,
    evidence: null,
    verify: { required: false, result: "skipped_not_live" },
  },
  packed_at: null,
  docs: SEALED_RIDE_DOCS,
};

export function redactForLog(input: unknown): unknown {
  return redactForLogJs(input);
}

export function serializeSealedRideEnvelope(envelope: SealedRideEnvelope): string {
  return serializeSealedRideEnvelopeJs(envelope);
}

export function createSealedRide(opts?: {
  purpose?: SealedRideEnvelope["purpose"];
  agent_id?: string | null;
  rider_claims?: SealedRiderClaims | null;
  attestation?: SealedAttestationEvidenceSlot | null;
}): SealedRideEnvelope {
  return createSealedRideJs(opts) as SealedRideEnvelope;
}

export function bindSealedRideSeat(
  envelope: SealedRideEnvelope,
  seat: { agent_id: string; api_key_hash_ok?: boolean | null }
): SealedRideEnvelope {
  return bindSealedRideSeatJs(envelope, seat) as SealedRideEnvelope;
}

export function verifySealedRideForExecute(
  envelope: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
) {
  return verifySealedRideForExecuteJs(envelope, env);
}

export function isSealedRideRequired(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean {
  return isSealedRideRequiredJs(env);
}

export { isForbiddenEnvelopeFieldName, SEALED_RIDE_DOCS };
