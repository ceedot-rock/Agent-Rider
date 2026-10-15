/**
 * Tollkeeper signed receipts — ES256 envelopes, node:crypto only.
 * Selftest-importable core. TypeScript re-exports via toll-receipt.ts.
 *
 * Envelope shape mirrors ~/workspace/rider-toll/tollkeeper/envelope.py:
 *   { payload, sig: base64url(r||s), kid, alg: "ES256" }
 * Canonical JSON: keys sorted, separators (",",":"), non-ASCII escaped
 * (matches Python ensure_ascii=True). Non-integer numbers are REFUSED.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

export class TollReceiptError extends Error {}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Escape every non-ASCII code point as \uXXXX (astral → surrogate pair). */
function asciiEscape(s) {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      out += ch;
    } else if (cp <= 0xffff) {
      out += "\\u" + cp.toString(16).padStart(4, "0");
    } else {
      const v = cp - 0x10000;
      out +=
        "\\u" +
        (0xd800 + (v >> 10)).toString(16).padStart(4, "0") +
        "\\u" +
        (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    }
  }
  return out;
}

function canonicalValue(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v))
      throw new TollReceiptError(
        "floats forbidden in envelope payloads; use integer micro-USDC"
      );
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalValue).join(",") + "]";
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalValue(v[k])).join(",") +
      "}"
    );
  }
  throw new TollReceiptError(
    `unserializable value in envelope payload: ${typeof v}`
  );
}

/** Deterministic bytes for a payload dict. Throws TollReceiptError on floats. */
export function canonicalJson(payload) {
  return asciiEscape(canonicalValue(payload));
}

function b64uEncode(b) {
  return Buffer.from(b).toString("base64url");
}

function b64uDecode(s) {
  if (typeof s !== "string" || s.length === 0)
    throw new TollReceiptError("bad base64url input");
  return Buffer.from(s, "base64url");
}

/**
 * The DEDICATED toll signing key (TOLL_SIGNING_KEY, ES256 P-256 PKCS8 PEM).
 * All toll receipts are signed with this key — never the Rider identity key.
 * Missing key → throw. There is deliberately NO fallback to RIDER_PRIVATE_KEY:
 * a toll receipt must never be minted under the wrong key, and a missing
 * key must surface as a loud 500, not a silent substitution.
 */
function tollPrivateKey() {
  const pem = process.env.TOLL_SIGNING_KEY;
  if (!pem)
    throw new TollReceiptError(
      "Missing TOLL_SIGNING_KEY environment variable (ES256 PKCS8 PEM). " +
        "Toll receipts are never signed with the Rider identity key."
    );
  return createPrivateKey(pem);
}

/** RFC 7638 JWK thumbprint of a public KeyObject. */
function jwkThumbprintOf(keyObj) {
  const jwk = keyObj.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y)
    throw new TollReceiptError("toll signer key is not a P-256 EC key");
  const thumb = canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64uEncode(createHash("sha256").update(thumb, "utf8").digest());
}

/**
 * RFC 7638 JWK thumbprint of a toll signer public key.
 * With an explicit SPKI PEM, thumbprints that key (used for the Rider
 * identity key entry and previous-key entries). With no argument, derives
 * the public half from TOLL_SIGNING_KEY — the kid that signTollPayload
 * stamps on new receipts.
 */
export function tollSignerKid(publicKeyPem) {
  const keyObj = publicKeyPem
    ? createPublicKey(publicKeyPem)
    : createPublicKey(tollPrivateKey());
  return jwkThumbprintOf(keyObj);
}

/**
 * Public JWK of the dedicated toll signer, derived from TOLL_SIGNING_KEY.
 * Throws when the key is missing — verification material for the CURRENT
 * signer cannot be fabricated.
 */
export function tollPublicJwk() {
  const keyObj = createPublicKey(tollPrivateKey());
  const jwk = keyObj.export({ format: "jwk" });
  return { ...jwk, kid: jwkThumbprintOf(keyObj), alg: "ES256", use: "sig" };
}

/**
 * Public JWK of the Rider identity key (RIDER_PUBLIC_KEY, SPKI PEM).
 * Kept in the JWKS for backwards compatibility: receipts minted before
 * the dedicated toll signer existed still verify.
 */
export function riderPublicJwk() {
  const pem = process.env.RIDER_PUBLIC_KEY;
  if (!pem)
    throw new TollReceiptError(
      "Missing RIDER_PUBLIC_KEY environment variable (ES256 SPKI PEM)."
    );
  const keyObj = createPublicKey(pem);
  const jwk = keyObj.export({ format: "jwk" });
  return { ...jwk, kid: jwkThumbprintOf(keyObj), alg: "ES256", use: "sig" };
}

/**
 * Previous toll-signer public keys still trusted for verification during a
 * rotation grace period. TOLL_PREVIOUS_PUBLIC_JWKS is a JSON array of public
 * JWK objects: [{"kty":"EC","crv":"P-256","x":"…","y":"…"}]. Each entry gets
 * its RFC 7638 thumbprint as kid. Malformed entries throw — trust roots must
 * never be silently misread.
 */
export function previousTollPublicJwks(raw) {
  const src = (raw ?? process.env.TOLL_PREVIOUS_PUBLIC_JWKS ?? "").trim();
  if (!src) return [];
  let arr;
  try {
    arr = JSON.parse(src);
  } catch {
    throw new TollReceiptError("TOLL_PREVIOUS_PUBLIC_JWKS is not valid JSON");
  }
  if (!Array.isArray(arr))
    throw new TollReceiptError("TOLL_PREVIOUS_PUBLIC_JWKS must be a JSON array");
  return arr.map((entry, i) => {
    if (!isPlainObject(entry) || entry.kty !== "EC" || entry.crv !== "P-256" ||
        typeof entry.x !== "string" || typeof entry.y !== "string")
      throw new TollReceiptError(
        `TOLL_PREVIOUS_PUBLIC_JWKS[${i}] is not a P-256 public JWK`
      );
    const keyObj = createPublicKey({ key: entry, format: "jwk" });
    return { ...entry, kid: jwkThumbprintOf(keyObj), alg: "ES256", use: "sig" };
  });
}

/**
 * Parse TOLL_REVOKED_KIDS: "kid:2026-10-08T12:00:00Z,kid:2026-10-09T00:00:00Z".
 * Returns [{kid, revoked_at}]. Malformed entries throw — a revocation list
 * must never be silently misread. Revoked kids stay listed; they are never
 * dropped quietly.
 */
export function parseRevokedKids(raw) {
  const src = (raw ?? process.env.TOLL_REVOKED_KIDS ?? "").trim();
  if (!src) return [];
  return src.split(",").map((entry) => {
    const e = entry.trim();
    const i = e.indexOf(":"); // kid is base64url (no colons); ISO timestamps have them
    if (i <= 0)
      throw new TollReceiptError(`malformed TOLL_REVOKED_KIDS entry: ${e}`);
    const kid = e.slice(0, i).trim();
    const revoked_at = e.slice(i + 1).trim();
    if (!kid || !revoked_at || Number.isNaN(Date.parse(revoked_at)))
      throw new TollReceiptError(`malformed TOLL_REVOKED_KIDS entry: ${e}`);
    return { kid, revoked_at };
  });
}

/** All toll-signer public keys currently trusted: current + previous (grace). */
export function tollJwks() {
  const keys = [tollPublicJwk(), ...previousTollPublicJwks()];
  return { keys, revoked: parseRevokedKids() };
}

/**
 * Sign a payload dict → {payload, sig, kid, alg}.
 * Default: the DEDICATED toll signer (TOLL_SIGNING_KEY). Missing key throws —
 * there is no fallback to the Rider identity key.
 * opts.privateKey / opts.kid override env (selftests use ephemeral keys).
 */
export function signTollPayload(payload, opts) {
  if (!isPlainObject(payload))
    throw new TollReceiptError("payload must be a dict");
  const msg = Buffer.from(canonicalJson(payload), "utf8");
  const key = opts?.privateKey ?? tollPrivateKey();
  const kid = opts?.kid ?? tollSignerKid();
  const sig = cryptoSign("sha256", msg, { key, dsaEncoding: "ieee-p1363" });
  return { payload, sig: b64uEncode(sig), kid, alg: "ES256" };
}

function lookupJwk(jwks, kid) {
  if (!jwks || typeof jwks !== "object") return null;
  if (Array.isArray(jwks.keys)) {
    for (const jwk of jwks.keys) {
      if (isPlainObject(jwk) && jwk.kid === kid) return jwk;
    }
    return null;
  }
  const direct = jwks[kid];
  return isPlainObject(direct) ? direct : null;
}

function revokedEntries(jwks) {
  if (!jwks || typeof jwks !== "object") return [];
  const r = jwks.revoked;
  if (!Array.isArray(r)) return [];
  return r.filter((e) => e && typeof e.kid === "string");
}

/**
 * Verify an envelope against a JWKS. Returns the payload dict.
 * Throws TollReceiptError on any failure — fail closed.
 *
 * Revocation is checked FIRST, against the JWKS's own "revoked" list:
 * a revoked kid fails closed with the recognizable code "revoked_kid",
 * whether or not the key is still listed in keys[]. An unknown kid fails
 * with "unknown kid". Every failure mode is a named, recognizable code —
 * never a silent pass.
 */
export function verifyTollEnvelope(envelope, jwks) {
  if (!isPlainObject(envelope))
    throw new TollReceiptError("envelope must be a dict");
  for (const f of ["payload", "sig", "kid", "alg"]) {
    if (!(f in envelope))
      throw new TollReceiptError(`envelope missing field: ${f}`);
  }
  if (envelope.alg !== "ES256")
    throw new TollReceiptError(`unsupported alg: ${String(envelope.alg)}`);
  if (typeof envelope.kid !== "string" || !envelope.kid)
    throw new TollReceiptError("envelope kid must be a non-empty string");
  if (revokedEntries(jwks).some((r) => r.kid === envelope.kid))
    throw new TollReceiptError(`revoked_kid: ${envelope.kid}`);
  const jwk = lookupJwk(jwks, envelope.kid);
  if (!jwk) throw new TollReceiptError(`unknown kid: ${envelope.kid}`);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string")
    throw new TollReceiptError("JWK is not a P-256 EC key");
  let raw;
  try {
    raw = b64uDecode(envelope.sig);
  } catch {
    throw new TollReceiptError("base64url decode failed");
  }
  if (raw.length !== 64) throw new TollReceiptError("bad signature length");
  if (!isPlainObject(envelope.payload))
    throw new TollReceiptError("envelope payload must be a dict");
  const msg = Buffer.from(canonicalJson(envelope.payload), "utf8");
  let ok = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    ok = cryptoVerify("sha256", msg, { key, dsaEncoding: "ieee-p1363" }, raw);
  } catch {
    ok = false;
  }
  if (!ok) throw new TollReceiptError("signature verification failed");
  return envelope.payload;
}

/** Non-raising verify: [true, payload] or [false, reason]. */
export function verifyTollEnvelopeOk(envelope, jwks) {
  try {
    return [true, verifyTollEnvelope(envelope, jwks)];
  } catch (err) {
    return [false, err.message];
  }
}

/** Content id of a signed envelope (sha256 hex of its canonical form). */
export function tollEnvelopeId(envelope) {
  const raw = canonicalJson({
    payload: envelope.payload,
    sig: envelope.sig,
    kid: envelope.kid,
    alg: envelope.alg,
  });
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Ephemeral P-256 keypair for selftests. Never touches env keys. */
export function devTollKeypair(kid = "dev-toll-1") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return { privateKey, publicKey, kid };
}

/** {kid: public JWK} dict for a test public key — the JWKS verify() expects. */
export function jwksForTest(publicKey, kid) {
  const jwk = publicKey.export({ format: "jwk" });
  return { [kid]: { ...jwk, kid } };
}

/**
 * The lab JWKS for verifying lab-sealed envelopes.
 *
 * keys: the Rider identity key (backwards compat — receipts minted before
 * the dedicated toll signer still verify) PLUS the current toll signer key
 * PLUS any previous toll-signer keys still in their rotation grace period.
 * revoked: kids that must fail closed with "revoked_kid", listed with
 * revoked_at timestamps and never silently dropped.
 *
 * The toll key entry is included only when TOLL_SIGNING_KEY is set:
 * verification degrades gracefully, while SIGNING strictly requires it.
 */
export function labJwks() {
  const keys = [riderPublicJwk()];
  if (process.env.TOLL_SIGNING_KEY) {
    keys.push(tollPublicJwk(), ...previousTollPublicJwks());
  }
  return { keys, revoked: parseRevokedKids() };
}
