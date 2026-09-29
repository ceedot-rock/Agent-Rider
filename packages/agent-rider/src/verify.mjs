/**
 * Verify an Agent-Rider credential with only the public JWKS and the public
 * revocation list. No lab SDK and no call to POST /api/rider/verify.
 *
 * Node 20+. Uses WebCrypto. Does not log the token.
 */

export const JWKS_URL = "https://agentrider.fly.dev/.well-known/jwks.json";
export const REVOCATION_URL = "https://agentrider.fly.dev/.well-known/rider-revocation.json";
export const ISSUER = "agentrider.dev";

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function importVerifyKey(jwk) {
  const { kty, crv, x, y } = jwk;
  return crypto.subtle.importKey(
    "jwk",
    { kty, crv, x, y, alg: "ES256", ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

/**
 * @param {string} token
 * @param {{
 *   jwksUrl?: string,
 *   revocationUrl?: string,
 *   jwks?: { keys: object[] },
 *   revoked?: { jti: string }[],
 *   requireRevocation?: boolean,
 *   fetchImpl?: typeof fetch,
 *   now?: number,
 * }} [opts]
 */
export async function verifyRiderCredential(token, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const requireRevocation = opts.requireRevocation !== false;
  if (typeof token !== "string" || token.split(".").length !== 3) {
    return { valid: false, reason: "malformed" };
  }
  const [h64, p64, s64] = token.split(".");
  let header;
  let payload;
  try {
    header = decodeJson(h64);
    payload = decodeJson(p64);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (header.alg !== "ES256") return { valid: false, reason: "bad_alg" };
  if (payload.iss !== ISSUER) return { valid: false, reason: "bad_iss" };
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return { valid: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return { valid: false, reason: "not_yet_valid" };
  }

  let keys = opts.jwks?.keys;
  if (!keys) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(opts.jwksUrl ?? JWKS_URL);
    if (!res.ok) return { valid: false, reason: "jwks_unavailable" };
    keys = (await res.json()).keys;
  }
  const jwk = (keys ?? []).find((k) => !header.kid || k.kid === header.kid);
  if (!jwk) return { valid: false, reason: "unknown_kid" };

  const key = await importVerifyKey(jwk);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlToBytes(s64),
    new TextEncoder().encode(`${h64}.${p64}`)
  );
  if (!ok) return { valid: false, reason: "bad_signature" };

  let revoked = opts.revoked;
  if (!revoked && requireRevocation) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(opts.revocationUrl ?? REVOCATION_URL);
    if (!res.ok) return { valid: false, reason: "revocation_unavailable", rider: publicRider(payload) };
    const body = await res.json();
    revoked = Array.isArray(body.revoked) ? body.revoked : [];
  }
  if (requireRevocation && (revoked ?? []).some((row) => row && row.jti === payload.jti)) {
    return { valid: false, reason: "revoked", rider: publicRider(payload) };
  }

  return { valid: true, rider: publicRider(payload) };
}

function publicRider(payload) {
  return {
    agent_id: payload.agent_id,
    operator_id: payload.operator_id,
    level: payload.level,
    scopes: payload.scopes,
    jti: payload.jti,
  };
}
