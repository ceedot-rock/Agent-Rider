/**
 * Host attestation evidence schema + fail-closed gate — PARKED / NOT LIVE.
 *
 * Runtime lives in attestation-evidence.mjs (importable by Node selftests).
 * This module re-exports types and thin TS wrappers for Next routes.
 *
 * ATTESTATION_REQUIRED default OFF. When on: missing / malformed / shape-ok-
 * but-verify-not-implemented → refuse (never soft-pass as Nitro-live).
 * GET /api/attestation stays 501 until Nitro/SNP is proven.
 *
 * Never embed ar_ / RIDER_PRIVATE_KEY / JWTs in evidence.
 */

export type AttestationPlatform =
  | "none"
  | "nitro"
  | "sev_snp"
  | "gcp_confidential";

/** Draft evidence schema (structure only — no platform quote verify). */
export type AttestationEvidence = {
  status?: string;
  platform: AttestationPlatform;
  measurement: string | null;
  nonce: string | null;
  issued_at: string | null;
  /** Opaque platform quote/doc — null while PARKED. */
  evidence: unknown | null;
  verify?: {
    required?: boolean;
    result?: string;
  };
  docs?: string;
};

export type AttestationShapeOk = { ok: true; evidence: AttestationEvidence };
export type AttestationShapeFail = {
  ok: false;
  error: string;
  detail: string;
};
export type AttestationShapeResult = AttestationShapeOk | AttestationShapeFail;

export type AttestationGateOk = { ok: true };
export type AttestationGateRefuse = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};
export type AttestationGateResult = AttestationGateOk | AttestationGateRefuse;

// Re-export runtime from .mjs (Next/webpack resolves; selftests import .mjs directly).
export {
  ATTESTATION_DOCS,
  ATTESTATION_REQUIRED_HTTP_STATUS,
  ATTESTATION_PLATFORMS,
  isAttestationRequired,
  validateAttestationEvidenceShape,
  assertAttestationForSensitiveOp,
  attestationRefuseBody,
  readAttestationEvidence,
  collectAttestationEvidenceStub,
} from "./attestation-evidence.mjs";
