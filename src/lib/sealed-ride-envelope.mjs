/**
 * Sealed ride payload envelope — thin helpers (PARKED / not live).
 *
 * Packs metadata for a future sealed mint boundary. Never embeds or logs ar_
 * values, RIDER_PRIVATE_KEY, JWTs, or payment secrets.
 *
 * See docs/HOST_ATTESTATION.md § Sealed ride payload.
 */

const REDACTED = "[REDACTED]";

/** Own-key names that must never appear in serialized envelopes / logs. */
const FORBIDDEN_FIELD_RE =
  /^(ar_.*|api_key|apikey|private_key|rider_private_key|secret|password|bearer|authorization|x-payment|x_payment|rider_token|jwt)$/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isForbiddenEnvelopeFieldName(name) {
  return FORBIDDEN_FIELD_RE.test(String(name));
}

/**
 * Deep-ish redact for log-safe JSON: strips forbidden keys, redacts string
 * values that look like ar_… secrets. Does not claim encryption.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function redactForLog(input) {
  return redactInner(input, 0);
}

/**
 * Serialize envelope to JSON with redaction. Throws if top-level forbidden
 * key material fields are present (fail closed on pack mistakes).
 *
 * @param {object} envelope
 * @returns {string}
 */
export function serializeSealedRideEnvelope(envelope) {
  if (envelope == null || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("sealed_ride_envelope_invalid: envelope must be an object");
  }
  const obj = /** @type {Record<string, unknown>} */ (envelope);
  for (const k of Object.keys(obj)) {
    if (isForbiddenEnvelopeFieldName(k)) {
      throw new Error(
        `sealed_ride_envelope_forbidden_field: ${k} (never embed ar_/secrets)`
      );
    }
  }
  if ("key_material" in obj || "ar_api_key" in obj || "api_key_plaintext" in obj) {
    throw new Error(
      "sealed_ride_envelope_forbidden_field: key material fields are not allowed"
    );
  }
  return JSON.stringify(redactForLog(obj));
}

/**
 * @param {unknown} input
 * @param {number} depth
 */
function redactInner(input, depth) {
  if (depth > 8) return "[MAX_DEPTH]";
  if (input == null) return input;
  if (typeof input === "string") {
    if (/^ar_[A-Za-z0-9_-]{8,}/.test(input)) return REDACTED;
    if (/^-----BEGIN .*PRIVATE KEY-----/.test(input)) return REDACTED;
    return input;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactInner(v, depth + 1));
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (isForbiddenEnvelopeFieldName(k)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactInner(v, depth + 1);
  }
  return out;
}

export const SEALED_RIDE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/HOST_ATTESTATION.md";
