/**
 * Attestation evidence shape check + ATTESTATION_REQUIRED fail-closed gate.
 *
 * PARKED / NOT LIVE: this does NOT verify Nitro, SEV-SNP, or any platform quote.
 * Structure-only validation. When ATTESTATION_REQUIRED is on, sensitive ops refuse
 * (missing evidence, malformed shape, or shape-ok-but-verify-not-implemented).
 *
 * Never log or embed ar_ values, RIDER_PRIVATE_KEY, or JWTs.
 *
 * Env: ATTESTATION_REQUIRED — default off. Truthy: "1" | "true" | "yes" (case-insensitive).
 */

export const ATTESTATION_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/HOST_ATTESTATION.md";

export const ATTESTATION_REQUIRED_HTTP_STATUS = 403;

/** Platforms allowed in the draft evidence schema (none = not live). */
export const ATTESTATION_PLATFORMS = Object.freeze([
  "none",
  "nitro",
  "sev_snp",
  "gcp_confidential",
]);

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isAttestationRequired(env = process.env) {
  const raw = env.ATTESTATION_REQUIRED;
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Structure-only check. Does NOT claim cryptographic / Nitro verify.
 *
 * Expected shape (draft):
 * {
 *   status?: string,
 *   platform: "none"|"nitro"|"sev_snp"|"gcp_confidential",
 *   measurement: string|null,
 *   nonce: string|null,
 *   issued_at: string|null,  // ISO-8601 when set
 *   evidence: unknown|null,  // opaque platform blob; no ar_ / key material fields
 *   verify?: { required?: boolean, result?: string },
 *   docs?: string
 * }
 *
 * Forbidden own keys (never accept as evidence fields): ar_*, api_key, private_key,
 * rider_private_key, secret, password, bearer, authorization.
 *
 * @param {unknown} input
 * @returns {{ ok: true, evidence: object } | { ok: false, error: string, detail: string }}
 */
export function validateAttestationEvidenceShape(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: "evidence must be a non-null object",
    };
  }

  const obj = /** @type {Record<string, unknown>} */ (input);
  const forbidden = findForbiddenKeyMaterial(obj);
  if (forbidden) {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: `forbidden key material field: ${forbidden} (never embed ar_/secrets in evidence)`,
    };
  }

  if (!("platform" in obj)) {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: "missing required field: platform",
    };
  }

  if (!ATTESTATION_PLATFORMS.includes(/** @type {string} */ (obj.platform))) {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: `platform must be one of: ${ATTESTATION_PLATFORMS.join(", ")}`,
    };
  }

  for (const nullableStr of ["measurement", "nonce", "issued_at"]) {
    if (!(nullableStr in obj)) {
      return {
        ok: false,
        error: "attestation_evidence_malformed",
        detail: `missing required field: ${nullableStr}`,
      };
    }
    const v = obj[nullableStr];
    if (v !== null && typeof v !== "string") {
      return {
        ok: false,
        error: "attestation_evidence_malformed",
        detail: `${nullableStr} must be string or null`,
      };
    }
  }

  if (!("evidence" in obj)) {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: "missing required field: evidence",
    };
  }

  if (obj.verify != null) {
    if (typeof obj.verify !== "object" || Array.isArray(obj.verify)) {
      return {
        ok: false,
        error: "attestation_evidence_malformed",
        detail: "verify must be an object when present",
      };
    }
    const verify = /** @type {Record<string, unknown>} */ (obj.verify);
    if ("required" in verify && typeof verify.required !== "boolean") {
      return {
        ok: false,
        error: "attestation_evidence_malformed",
        detail: "verify.required must be boolean when present",
      };
    }
    if ("result" in verify && typeof verify.result !== "string") {
      return {
        ok: false,
        error: "attestation_evidence_malformed",
        detail: "verify.result must be string when present",
      };
    }
  }

  if ("status" in obj && obj.status != null && typeof obj.status !== "string") {
    return {
      ok: false,
      error: "attestation_evidence_malformed",
      detail: "status must be string when present",
    };
  }

  return { ok: true, evidence: obj };
}

/**
 * Fail-closed gate for sensitive ops (rider issue, settle, sealed mint).
 *
 * - ATTESTATION_REQUIRED off → allow (no behavior change).
 * - on + no evidence → refuse.
 * - on + malformed → refuse.
 * - on + shape-ok → still refuse: Nitro/platform verify is NOT implemented (no soft live).
 *
 * @param {unknown} [evidence]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ ok: true } | { ok: false, status: number, body: object }}
 */
export function assertAttestationForSensitiveOp(evidence, env = process.env) {
  if (!isAttestationRequired(env)) {
    return { ok: true };
  }

  if (evidence == null) {
    return {
      ok: false,
      status: ATTESTATION_REQUIRED_HTTP_STATUS,
      body: attestationRefuseBody("attestation_evidence_required", {
        detail:
          "ATTESTATION_REQUIRED is on but no evidence was provided. Host attestation verify is not live — fail-closed.",
      }),
    };
  }

  const shape = validateAttestationEvidenceShape(evidence);
  if (!shape.ok) {
    return {
      ok: false,
      status: ATTESTATION_REQUIRED_HTTP_STATUS,
      body: attestationRefuseBody(shape.error, { detail: shape.detail }),
    };
  }

  // Shape ok but cryptographic verify is not implemented — never soft-pass as Nitro-live.
  return {
    ok: false,
    status: ATTESTATION_REQUIRED_HTTP_STATUS,
    body: attestationRefuseBody("attestation_verify_not_implemented", {
      detail:
        "Evidence shape is structurally valid, but platform quote verify is not live. Fail-closed (no soft Nitro-live). See docs.",
      shape_ok: true,
      nitro_verify: false,
    }),
  };
}

/**
 * @param {string} error
 * @param {Record<string, unknown>} [extra]
 */
export function attestationRefuseBody(error, extra = {}) {
  return {
    error,
    status: "attestation_required_refused",
    live: false,
    message:
      "Host attestation is PARKED until proven — ATTESTATION_REQUIRED fail-closed (not live Nitro).",
    docs: ATTESTATION_DOCS,
    hint: "Unset ATTESTATION_REQUIRED (default off) for normal Fly issue/settle. Do not claim attested host.",
    ...extra,
  };
}

/**
 * Scan own keys only (shallow + one-level nested object keys) for secret-ish names.
 * Does not recurse into opaque `evidence` blob values beyond direct own keys of the root
 * and of `verify`.
 * @param {Record<string, unknown>} obj
 * @returns {string | null}
 */
function findForbiddenKeyMaterial(obj) {
  const bad = (k) => {
    const lower = k.toLowerCase();
    if (lower.startsWith("ar_")) return true;
    if (
      lower === "api_key" ||
      lower === "apikey" ||
      lower === "private_key" ||
      lower === "rider_private_key" ||
      lower === "secret" ||
      lower === "password" ||
      lower === "bearer" ||
      lower === "authorization" ||
      lower === "x-payment" ||
      lower === "x_payment"
    ) {
      return true;
    }
    return false;
  };

  for (const k of Object.keys(obj)) {
    if (bad(k)) return k;
  }
  if (obj.verify && typeof obj.verify === "object" && !Array.isArray(obj.verify)) {
    for (const k of Object.keys(/** @type {object} */ (obj.verify))) {
      if (bad(k)) return `verify.${k}`;
    }
  }
  return null;
}

/**
 * Optional evidence from header X-Attestation-Evidence (JSON string) or
 * body.attestation_evidence. Does not log values.
 *
 * @param {{ headerJson?: string | null, body?: unknown }} src
 * @returns {unknown}
 */
export function readAttestationEvidence(src) {
  if (src.headerJson != null && String(src.headerJson).trim() !== "") {
    try {
      return JSON.parse(String(src.headerJson));
    } catch {
      return {
        __malformed_header: true,
        platform: "none",
        // Force shape failure without looking like a real quote
      };
    }
  }
  if (src.body && typeof src.body === "object" && !Array.isArray(src.body)) {
    const b = /** @type {Record<string, unknown>} */ (src.body);
    if ("attestation_evidence" in b) return b.attestation_evidence;
  }
  return undefined;
}
