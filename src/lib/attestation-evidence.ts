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
import {
  ATTESTATION_DOCS as ATTESTATION_DOCS_JS,
  ATTESTATION_REQUIRED_HTTP_STATUS as ATTESTATION_REQUIRED_HTTP_STATUS_JS,
  ATTESTATION_PLATFORMS as ATTESTATION_PLATFORMS_JS,
  isAttestationRequired as isAttestationRequiredJs,
  validateAttestationEvidenceShape as validateAttestationEvidenceShapeJs,
  assertAttestationForSensitiveOp as assertAttestationForSensitiveOpJs,
  attestationRefuseBody as attestationRefuseBodyJs,
  readAttestationEvidence as readAttestationEvidenceJs,
  collectAttestationEvidenceStub as collectAttestationEvidenceStubJs,
} from "./attestation-evidence.mjs";

export const ATTESTATION_DOCS = ATTESTATION_DOCS_JS;
export const ATTESTATION_REQUIRED_HTTP_STATUS = ATTESTATION_REQUIRED_HTTP_STATUS_JS;
export const ATTESTATION_PLATFORMS = ATTESTATION_PLATFORMS_JS;

export function isAttestationRequired(env?: NodeJS.ProcessEnv): boolean {
  return isAttestationRequiredJs(env);
}

export function validateAttestationEvidenceShape(input: unknown): AttestationShapeResult {
  return validateAttestationEvidenceShapeJs(input) as AttestationShapeResult;
}

export function assertAttestationForSensitiveOp(
  evidence: unknown,
  env?: NodeJS.ProcessEnv
): AttestationGateResult {
  return assertAttestationForSensitiveOpJs(evidence, env) as AttestationGateResult;
}

export function attestationRefuseBody(
  error: string,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return attestationRefuseBodyJs(error, extra);
}

export function readAttestationEvidence(src: {
  headerJson?: string | null;
  body?: unknown;
}): unknown {
  return readAttestationEvidenceJs(src);
}

export function collectAttestationEvidenceStub(opts?: {
  nonce?: string | null;
}): Record<string, unknown> {
  return collectAttestationEvidenceStubJs(opts);
}
