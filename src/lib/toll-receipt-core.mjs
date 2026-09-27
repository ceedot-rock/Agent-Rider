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

function labPrivateKey() {
  const pem = process.env.RIDER_PRIVATE_KEY;
  if (!pem)
    throw new TollReceiptError(
      "Missing RIDER_PRIVATE_KEY environment variable (ES256 PKCS8 PEM)."
    );
  return createPrivateKey(pem);
}

/** RFC 7638 JWK thumbprint of the lab ES256 public key (matches rider.ts kid). */
export function tollSignerKid(publicKeyPem) {
  const pem = publicKeyPem ?? process.env.RIDER_PUBLIC_KEY;
  if (!pem)
    throw new TollReceiptError(
      "Missing RIDER_PUBLIC_KEY environment variable (ES256 SPKI PEM)."
    );
  const jwk = createPublicKey(pem).export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y)
    throw new TollReceiptError("toll signer key is not a P-256 EC key");
  const thumb = canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64uEncode(createHash("sha256").update(thumb, "utf8").digest());
}

/**
 * Sign a payload dict → {payload, sig, kid, alg}.
 * opts.privateKey / opts.kid override env (selftests use ephemeral keys).
 */
export function signTollPayload(payload, opts) {
  if (!isPlainObject(payload))
    throw new TollReceiptError("payload must be a dict");
  const msg = Buffer.from(canonicalJson(payload), "utf8");
  const key = opts?.privateKey ?? labPrivateKey();
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

/**
 * Verify an envelope against a JWKS. Returns the payload dict.
 * Throws TollReceiptError on any failure — fail closed.
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
 * The lab JWKS for verifying lab-sealed envelopes (delivery receipts,
 * payment receipts). Built from RIDER_PUBLIC_KEY; kid = RFC 7638 thumbprint.
 * Throws TollReceiptError when env is missing — routes fail closed.
 */
export function labJwks() {
  const pem = process.env.RIDER_PUBLIC_KEY;
  if (!pem)
    throw new TollReceiptError(
      "Missing RIDER_PUBLIC_KEY environment variable (ES256 SPKI PEM)."
    );
  const jwk = createPublicKey(pem).export({ format: "jwk" });
  const kid = tollSignerKid(pem);
  return { keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] };
}
