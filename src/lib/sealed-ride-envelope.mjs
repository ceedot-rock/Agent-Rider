/**
 * Sealed ride payload envelope — create → bind seat → verify (PARKED / not live).
 *
 * Packs metadata for a future sealed mint boundary. Never embeds or logs ar_
 * values, RIDER_PRIVATE_KEY, JWTs, or payment secrets.
 *
 * Env: SEALED_RIDE_REQUIRED — default off. Truthy: "1" | "true" | "yes".
 * When on, verifySealedRideForExecute refuses unbound / invalid envelopes.
 * When off, verify is a no-op allow (production unchanged).
 *
 * See docs/HOST_ATTESTATION.md § Sealed ride payload.
 */

const REDACTED = "[REDACTED]";

/** Own-key names that must never appear in serialized envelopes / logs. */
const FORBIDDEN_FIELD_RE =
  /^(ar_.*|api_key|apikey|private_key|rider_private_key|secret|password|bearer|authorization|x-payment|x_payment|rider_token|jwt)$/i;

export const SEALED_RIDE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/HOST_ATTESTATION.md";

export const SEALED_RIDE_REQUIRED_HTTP_STATUS = 403;

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isForbiddenEnvelopeFieldName(name) {
  return FORBIDDEN_FIELD_RE.test(String(name));
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isSealedRideRequired(env = process.env) {
  const raw = env.SEALED_RIDE_REQUIRED ?? env.SEALED_RIDE;
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
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
 * Create an unbound sealed-ride envelope (structure only — not live Nitro).
 *
 * @param {{ purpose?: string, agent_id?: string | null, rider_claims?: object | null, attestation?: object | null }} [opts]
 * @returns {object}
 */
export function createSealedRide(opts = {}) {
  const ride_id = `sr_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const purpose = opts.purpose ?? "sealed_preview";
  if (!["rider_mint", "settle_gate", "sealed_preview", "execute"].includes(purpose)) {
    throw new Error(`sealed_ride_invalid_purpose: ${purpose}`);
  }
  return {
    v: 1,
    ride_id,
    purpose,
    seat_bound: false,
    seat: null,
    rider_claims: opts.rider_claims ?? null,
    api_key_hash_ok: null,
    agent_id: opts.agent_id ?? null,
    attestation: opts.attestation ?? {
      platform: "none",
      measurement: null,
      nonce: null,
      issued_at: null,
      evidence: null,
      verify: { required: false, result: "skipped_not_live" },
    },
    packed_at: new Date().toISOString(),
    docs: SEALED_RIDE_DOCS,
  };
}

/**
 * Bind a seat (agent identity) to an unbound sealed ride. Never takes ar_ plaintext.
 *
 * @param {object} envelope
 * @param {{ agent_id: string, api_key_hash_ok?: boolean | null }} seat
 * @returns {object}
 */
export function bindSealedRideSeat(envelope, seat) {
  if (envelope == null || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("sealed_ride_envelope_invalid: envelope must be an object");
  }
  const obj = /** @type {Record<string, unknown>} */ (envelope);
  if (obj.v !== 1) {
    throw new Error("sealed_ride_envelope_invalid: unsupported version");
  }
  if (obj.seat_bound === true) {
    throw new Error("sealed_ride_already_bound");
  }
  if (!seat || typeof seat !== "object" || typeof seat.agent_id !== "string" || !seat.agent_id.trim()) {
    throw new Error("sealed_ride_bind_invalid: agent_id required");
  }
  const agent_id = seat.agent_id.trim();
  if (/^ar_/.test(agent_id)) {
    throw new Error("sealed_ride_bind_forbidden: agent_id must not look like an ar_ secret");
  }
  return {
    ...obj,
    seat_bound: true,
    seat: { agent_id },
    agent_id,
    api_key_hash_ok:
      typeof seat.api_key_hash_ok === "boolean" ? seat.api_key_hash_ok : obj.api_key_hash_ok ?? null,
    packed_at: new Date().toISOString(),
  };
}

/**
 * Verify sealed ride for execute path.
 * - SEALED_RIDE_REQUIRED off → allow (pass-through).
 * - on + missing/unbound/invalid → refuse.
 * - on + bound + shape-ok → accept (structure gate only; not Nitro-live).
 *
 * @param {unknown} envelope
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ ok: true, envelope?: object, skipped?: boolean } | { ok: false, status: number, body: object }}
 */
export function verifySealedRideForExecute(envelope, env = process.env) {
  if (!isSealedRideRequired(env)) {
    return { ok: true, skipped: true };
  }

  if (envelope == null) {
    return {
      ok: false,
      status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
      body: sealedRefuseBody("sealed_ride_required", {
        detail: "SEALED_RIDE_REQUIRED is on but no sealed ride envelope was provided.",
      }),
    };
  }

  if (typeof envelope !== "object" || Array.isArray(envelope)) {
    return {
      ok: false,
      status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
      body: sealedRefuseBody("sealed_ride_invalid", {
        detail: "envelope must be a non-null object",
      }),
    };
  }

  const obj = /** @type {Record<string, unknown>} */ (envelope);
  for (const k of Object.keys(obj)) {
    if (isForbiddenEnvelopeFieldName(k)) {
      return {
        ok: false,
        status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
        body: sealedRefuseBody("sealed_ride_forbidden_field", {
          detail: `forbidden field: ${k}`,
        }),
      };
    }
  }

  if (obj.v !== 1) {
    return {
      ok: false,
      status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
      body: sealedRefuseBody("sealed_ride_invalid", { detail: "unsupported version" }),
    };
  }

  if (obj.seat_bound !== true || !obj.seat || typeof obj.seat !== "object") {
    return {
      ok: false,
      status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
      body: sealedRefuseBody("sealed_ride_unbound", {
        detail: "seat must be bound before execute when SEALED_RIDE_REQUIRED is on",
      }),
    };
  }

  const seat = /** @type {Record<string, unknown>} */ (obj.seat);
  if (typeof seat.agent_id !== "string" || !seat.agent_id.trim()) {
    return {
      ok: false,
      status: SEALED_RIDE_REQUIRED_HTTP_STATUS,
      body: sealedRefuseBody("sealed_ride_invalid", {
        detail: "bound seat.agent_id required",
      }),
    };
  }

  return { ok: true, envelope: obj };
}

/**
 * @param {string} error
 * @param {Record<string, unknown>} [extra]
 */
export function sealedRefuseBody(error, extra = {}) {
  return {
    error,
    status: "sealed_ride_required_refused",
    live: false,
    message:
      "Sealed ride is PARKED until proven — SEALED_RIDE_REQUIRED fail-closed (not live Nitro).",
    docs: SEALED_RIDE_DOCS,
    hint: "Unset SEALED_RIDE_REQUIRED (default off) for normal execute. Do not claim sealed host.",
    ...extra,
  };
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
