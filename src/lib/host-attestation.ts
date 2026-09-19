/**
 * Host attestation + sealed runtime — PARKED, NOT LIVE.
 *
 * Honesty lock: do not implement Nitro/SEV quote verify here. Routes always
 * answer 501 with { error: "host_attestation_planned", status: "not_live" }
 * until a later PR proves attestation end-to-end.
 *
 * HOST_ATTESTATION_LIVE defaults false. Setting it true does NOT enable
 * attestation while this scaffold is the only implementation — still not_live.
 * Future required-mode must fail closed (never soft-pass).
 *
 * Never log or embed ar_ values, RIDER_PRIVATE_KEY, or JWTs in evidence.
 */

export const HOST_ATTESTATION_PUBLIC_COPY =
  "Host attestation / sealed runtime — PARKED until proven (not live Nitro)" as const;

export type HostAttestationPlannedBody = {
  error: "host_attestation_planned";
  status: "not_live";
  message: typeof HOST_ATTESTATION_PUBLIC_COPY;
  live: false;
  platform: "none";
  feature_flag: {
    name: "HOST_ATTESTATION_LIVE";
    value: boolean;
    note: string;
  };
  evidence_preview: HostAttestationEvidencePreview;
  docs: string;
};

/** Draft evidence shape — docs only until live. */
export type HostAttestationEvidencePreview = {
  platform: "none" | "nitro" | "sev_snp" | "gcp_confidential";
  measurement: null;
  nonce: null;
  issued_at: null;
  evidence: null;
  verify: {
    required: false;
    result: "skipped_not_live";
  };
  note: string;
};

export const HOST_ATTESTATION_EVIDENCE_PREVIEW: HostAttestationEvidencePreview = {
  platform: "none",
  measurement: null,
  nonce: null,
  issued_at: null,
  evidence: null,
  verify: {
    required: false,
    result: "skipped_not_live",
  },
  note: "Preview only — no platform quotes while not_live. Fail-closed when required later.",
};

/** True only when env explicitly sets HOST_ATTESTATION_LIVE=true. Default false. */
export function isHostAttestationLiveFlag(): boolean {
  return process.env.HOST_ATTESTATION_LIVE === "true";
}

/**
 * Canonical planned body. Always live:false while scaffold-only.
 * Even if HOST_ATTESTATION_LIVE=true, attestation is not implemented.
 */
export function hostAttestationPlannedBody(): HostAttestationPlannedBody {
  const flag = isHostAttestationLiveFlag();
  return {
    error: "host_attestation_planned",
    status: "not_live",
    message: HOST_ATTESTATION_PUBLIC_COPY,
    live: false,
    platform: "none",
    feature_flag: {
      name: "HOST_ATTESTATION_LIVE",
      value: flag,
      note: flag
        ? "Flag is true but attestation is not implemented — still not_live (honesty lock)."
        : "Default false. Flip only after a proven verify path ships.",
    },
    evidence_preview: HOST_ATTESTATION_EVIDENCE_PREVIEW,
    docs: "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/HOST_ATTESTATION.md",
  };
}

export const HOST_ATTESTATION_HTTP_STATUS = 501 as const;
