/**
 * Toll-signer key rotation + revocation selftest.
 *
 * Proves the published verifier contract (ROTATION.md):
 *  (a) toll receipts are signed by the DEDICATED toll key, never the Rider key;
 *  (b) a missing TOLL_SIGNING_KEY fails closed with no fallback;
 *  (c) revoked kids fail closed with the recognizable code "revoked_kid";
 *  (d) unknown kids fail closed with "unknown_kid";
 *  (e) a stale verifier (pre-rotation JWKS snapshot) fails closed, never passes;
 *  (f) old Rider-key receipts still verify (backwards compat);
 *  (g) the full rotation walkthrough: grace period → revoke → old refused, new ok.
 *
 * Ephemeral keypairs only. Saves/restores process.env. No network, no DB.
 * Run: cd src && npm run selftest:toll-rotation
 */
import assertBase from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  signTollPayload,
  verifyTollEnvelope,
  verifyTollEnvelopeOk,
  tollSignerKid,
  tollPublicJwk,
  labJwks,
  parseRevokedKids,
  previousTollPublicJwks,
  TollReceiptError,
} from "./toll-receipt-core.mjs";
import { classifyEnvelopeError } from "./toll-sandbox-core.mjs";

let assertions = 0;
function eq(a, b, msg) { assertions++; assertBase.equal(a, b, msg); }
function deq(a, b, msg) { assertions++; assertBase.deepEqual(a, b, msg); }
function ok(a, msg) { assertions++; assertBase.ok(a, msg); }
function throws(fn, re, msg) {
  assertions++;
  assertBase.throws(fn, (e) => e instanceof TollReceiptError && re.test(e.message), msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── ephemeral fixtures ─────────────────────────────────────────────────────
function ephemeralKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey,
    publicKey,
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicPem: publicKey.export({ format: "pem", type: "spki" }),
  };
}

const RIDER = ephemeralKey(); // the "old" Rider identity key
const TOLL_A = ephemeralKey(); // toll signer v1
const TOLL_B = ephemeralKey(); // toll signer v2 (rotation target)
const ATTACKER = ephemeralKey();

const ENV_KEYS = [
  "TOLL_SIGNING_KEY",
  "RIDER_PUBLIC_KEY",
  "RIDER_PRIVATE_KEY",
  "TOLL_REVOKED_KIDS",
  "TOLL_PREVIOUS_PUBLIC_JWKS",
];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

function baseEnv() {
  process.env.RIDER_PUBLIC_KEY = RIDER.publicPem;
  process.env.TOLL_SIGNING_KEY = TOLL_A.privatePem;
  delete process.env.RIDER_PRIVATE_KEY;
  delete process.env.TOLL_REVOKED_KIDS;
  delete process.env.TOLL_PREVIOUS_PUBLIC_JWKS;
}

// ── 1. toll-signed receipt verifies; kid != rider kid ──────────────────────
{
  baseEnv();
  const env = signTollPayload({ t: 1 });
  const jwks = labJwks();
  eq(verifyTollEnvelope(env, jwks).t, 1, "toll-signed receipt verifies");
  const riderKid = tollSignerKid(RIDER.publicPem);
  ok(env.kid !== riderKid, "toll kid is distinct from rider kid");
  eq(env.kid, tollSignerKid(), "envelope kid matches toll signer thumbprint");
  eq(jwks.keys.length, 2, "JWKS serves two keys (rider + toll)");
  ok(jwks.keys.some((k) => k.kid === env.kid), "toll key listed in JWKS");
  ok(jwks.keys.some((k) => k.kid === riderKid), "rider key listed in JWKS");
  deq(jwks.revoked, [], "revoked list starts empty");
}

// ── 2. missing TOLL_SIGNING_KEY → throws, NO fallback to rider key ─────────
{
  baseEnv();
  delete process.env.TOLL_SIGNING_KEY;
  // even with a perfectly valid Rider private key present, no fallback:
  process.env.RIDER_PRIVATE_KEY = RIDER.privateKey.export({
    format: "pem",
    type: "pkcs8",
  });
  throws(
    () => signTollPayload({ a: 1 }),
    /TOLL_SIGNING_KEY/,
    "missing toll key throws (names TOLL_SIGNING_KEY)"
  );
  let fellBack = false;
  try {
    signTollPayload({ a: 1 });
  } catch (e) {
    fellBack = /RIDER_PRIVATE_KEY/.test(e.message) && !/TOLL_SIGNING_KEY/.test(e.message);
  }
  ok(!fellBack, "error does not suggest a rider-key fallback exists");
  // tollPublicJwk also fails closed
  throws(() => tollPublicJwk(), /TOLL_SIGNING_KEY/, "tollPublicJwk fails closed");
  restoreEnv();
}

// ── 3. revoked kid → revoked_kid (recognizable, fail closed) ────────────────
{
  baseEnv();
  const envA = signTollPayload({ t: 3 });
  const kidA = envA.kid;
  process.env.TOLL_REVOKED_KIDS = `${kidA}:2026-10-08T12:00:00Z`;
  const jwks = labJwks();
  ok(
    jwks.revoked.some((r) => r.kid === kidA && r.revoked_at === "2026-10-08T12:00:00Z"),
    "revoked kid listed with timestamp"
  );
  ok(
    jwks.keys.some((k) => k.kid === kidA),
    "revoked key stays listed in keys (never silently dropped)"
  );
  throws(
    () => verifyTollEnvelope(envA, jwks),
    /revoked_kid/,
    "revoked kid fails closed with revoked_kid"
  );
  eq(
    classifyEnvelopeError("revoked_kid: abc123"),
    "revoked_kid",
    "sandbox classifier maps revoked_kid"
  );
  // malformed revocation config is loud, never silently misread
  throws(() => parseRevokedKids("not-a-valid-entry"), /malformed/, "malformed entry throws");
  throws(() => parseRevokedKids("kid:not-a-date"), /malformed/, "bad timestamp throws");
}

// ── 4. unknown kid → unknown_kid ────────────────────────────────────────────
{
  baseEnv();
  const forged = signTollPayload(
    { t: 4 },
    { privateKey: ATTACKER.privateKey, kid: tollSignerKid(ATTACKER.publicPem) }
  );
  throws(
    () => verifyTollEnvelope(forged, labJwks()),
    /unknown kid/,
    "unknown kid throws"
  );
  eq(
    classifyEnvelopeError("unknown kid: xyz"),
    "unknown_kid",
    "sandbox classifier maps unknown_kid"
  );
}

// ── 5. stale verifier: pre-rotation JWKS snapshot fails closed ──────────────
{
  baseEnv(); // TOLL_A is the signer
  const kidBefore = tollSignerKid();
  const jwksBefore = JSON.parse(JSON.stringify(labJwks())); // deep snapshot
  process.env.TOLL_SIGNING_KEY = TOLL_B.privatePem; // rotate signing key
  const envNew = signTollPayload({ t: 5 });
  ok(envNew.kid !== kidBefore, "rotated kid differs from pre-rotation kid");
  throws(
    () => verifyTollEnvelope(envNew, jwksBefore),
    /unknown kid/,
    "stale JWKS snapshot fails closed with unknown_kid (never silent pass)"
  );
  const [freshOk] = verifyTollEnvelopeOk(envNew, labJwks());
  ok(freshOk, "fresh JWKS verifies the rotated receipt");
}

// ── 6. old Rider-key receipts still verify (backwards compat) ───────────────
{
  baseEnv();
  const riderEnv = signTollPayload(
    { t: 6, legacy: true },
    { privateKey: RIDER.privateKey, kid: tollSignerKid(RIDER.publicPem) }
  );
  eq(
    verifyTollEnvelope(riderEnv, labJwks()).t,
    6,
    "pre-rotation Rider-key receipt still verifies"
  );
}

// ── 7. rotation walkthrough: grace → revoke ─────────────────────────────────
{
  baseEnv(); // TOLL_A signs
  const envV1 = signTollPayload({ t: 7 });
  const kidV1 = envV1.kid;

  // step 2: new keypair generated (TOLL_B); old public key trusted during grace
  const v1jwk = TOLL_A.publicKey.export({ format: "jwk" });
  process.env.TOLL_PREVIOUS_PUBLIC_JWKS = JSON.stringify([
    { kty: "EC", crv: "P-256", x: v1jwk.x, y: v1jwk.y },
  ]);
  // step 3: flip signing to the new key
  process.env.TOLL_SIGNING_KEY = TOLL_B.privatePem;
  const jwksGrace = labJwks();
  ok(
    jwksGrace.keys.some((k) => k.kid === kidV1),
    "old kid present during grace period"
  );
  eq(verifyTollEnvelope(envV1, jwksGrace).t, 7, "old receipt verifies during grace");
  const envV2 = signTollPayload({ t: 8 });
  eq(verifyTollEnvelope(envV2, jwksGrace).t, 8, "new receipt verifies during grace");

  // step 4: grace over — mark old kid revoked (it STAYS listed)
  process.env.TOLL_REVOKED_KIDS = `${kidV1}:2026-10-08T13:00:00Z`;
  const jwksRevoked = labJwks();
  throws(
    () => verifyTollEnvelope(envV1, jwksRevoked),
    /revoked_kid/,
    "revoked old receipt fails closed with revoked_kid"
  );
  eq(
    verifyTollEnvelope(envV2, jwksRevoked).t,
    8,
    "new receipt still verifies after old revoked"
  );
  // malformed previous-keys config is loud
  throws(
    () => previousTollPublicJwks("not json"),
    /not valid JSON/,
    "malformed previous-keys JSON throws"
  );
  throws(
    () => previousTollPublicJwks('[{"kty":"RSA"}]'),
    /not a P-256 public JWK/,
    "non-EC previous key throws"
  );
}

// ── 8. rider.ts getJwks publishes the contract shape ────────────────────────
{
  const src = readFileSync(join(__dirname, "rider.ts"), "utf8");
  ok(/revoked/.test(src), "rider.ts getJwks mentions revoked");
  ok(/tollPublicJwk/.test(src), "rider.ts includes the toll signer key");
  ok(/previousTollPublicJwks/.test(src), "rider.ts includes grace-period keys");
}

restoreEnv();
console.log(`toll-rotation selftest: ${assertions} assertions green`);
