/**
 * Rider public attestation (no-account path) selftest.
 *
 * Proves: (a) notarization receipts sign and verify offline with the JWKS;
 * (b) the exactness shape runs the v5 pipeline (match + mismatch);
 * (c) the in-process rate limiter trips at the cap with retry_after;
 * (d) oversize bodies and floats are refused; (e) a missing signing key
 * throws (the route turns that into a 500, never an unsigned receipt);
 * (f) the route touches no billing/DB/metering code (source shape).
 *
 * Pure-core tests + route honesty assertions. No network, no DB.
 * Signing uses ephemeral dev keypairs only — never env keys.
 * Run: cd src && npm run selftest:toll-public-attest
 */
import assertBase from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  signTollPayload,
  verifyTollEnvelope,
  devTollKeypair,
  jwksForTest,
  TollReceiptError,
} from "./toll-receipt-core.mjs";
import {
  MAX_BODY_BYTES,
  PUBLIC_ATTEST_ISSUER,
  buildExactnessAttestation,
  buildNotarizationPayload,
  checkPublicAttestLimit,
  classifyAttestShape,
  isBodyTooLarge,
  publicAttestMaxPerHour,
  __resetPublicAttestLimits,
} from "./toll-public-core.mjs";

// ── assertion counter ──────────────────────────────────────────────────────
let assertions = 0;
function eq(a, b, msg) { assertions++; assertBase.equal(a, b, msg); }
function deq(a, b, msg) { assertions++; assertBase.deepEqual(a, b, msg); }
function ok(a, msg) { assertions++; assertBase.ok(a, msg); }
function throws(fn, msg) {
  assertions++;
  assertBase.throws(fn, msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const NOW = 1_750_000_000;

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ── 1. notarization sign → verify offline ────────────────────────────────────
{
  const k = devTollKeypair("public-attest-1");
  const jwks = jwksForTest(k.publicKey, k.kid);
  const payload = buildNotarizationPayload({
    payload: { hello: "world", n: 42 },
    attested_at: NOW,
  });
  eq(payload.type, "public-attestation", "receipt type");
  eq(payload.mode, "notarization", "receipt mode");
  eq(payload.issuer, PUBLIC_ATTEST_ISSUER, "issuer stamped");
  eq(
    payload.payload_hash,
    sha256Hex(canonicalJson({ payload: { hello: "world", n: 42 } })),
    "payload hash is sha256 of canonical payload"
  );
  const env = signTollPayload(payload, { privateKey: k.privateKey, kid: k.kid });
  eq(env.alg, "ES256", "envelope alg");
  const back = verifyTollEnvelope(env, jwks);
  deq(back, payload, "offline verify returns the exact payload");
}

// ── 2. exactness: match + mismatch via the v5 pipeline ─────────────────────
{
  const artifact = { lang: "python", code: "print(1)" };
  const goodStdout = sha256Hex(canonicalJson({ artifact }));
  const att = buildExactnessAttestation({
    artifact,
    claim: { stdout: goodStdout },
    checked_at: NOW,
  });
  eq(att.result, "pass", "matching claim passes");
  eq(att.payload.mode, "exactness", "exactness mode stamped");
  eq(att.payload.issuer, PUBLIC_ATTEST_ISSUER, "issuer stamped");
  eq(att.payload.result, "pass", "result in payload");

  const bad = buildExactnessAttestation({
    artifact,
    claim: { stdout: "wrong" },
    checked_at: NOW,
  });
  eq(bad.result, "refuse", "mismatched claim refuses");

  // malformed claim → OracleError (route turns into 400)
  throws(
    () =>
      buildExactnessAttestation({
        artifact: "not-a-dict",
        claim: { stdout: "x" },
        checked_at: NOW,
      }),
    "malformed artifact throws"
  );
}

// ── 3. rate limiter trips at the cap ───────────────────────────────────────
{
  const prev = process.env.PUBLIC_ATTEST_MAX_PER_HOUR;
  process.env.PUBLIC_ATTEST_MAX_PER_HOUR = "2";
  __resetPublicAttestLimits();
  eq(publicAttestMaxPerHour(), 2, "env override honored");
  const r1 = checkPublicAttestLimit("9.9.9.9");
  const r2 = checkPublicAttestLimit("9.9.9.9");
  ok(r1.ok && r2.ok, "first two requests ok");
  const r3 = checkPublicAttestLimit("9.9.9.9");
  ok(!r3.ok, "third request refused");
  ok(r3.retryAfter > 0 && r3.retryAfter <= 3600, "retry_after sane");
  // a different IP has its own bucket
  ok(checkPublicAttestLimit("8.8.8.8").ok, "per-IP buckets independent");
  __resetPublicAttestLimits();
  ok(checkPublicAttestLimit("9.9.9.9").ok, "reset clears buckets");
  if (prev === undefined) delete process.env.PUBLIC_ATTEST_MAX_PER_HOUR;
  else process.env.PUBLIC_ATTEST_MAX_PER_HOUR = prev;
  __resetPublicAttestLimits();
}

// ── 4. oversize guard ──────────────────────────────────────────────────────
{
  ok(!isBodyTooLarge("x".repeat(MAX_BODY_BYTES)), "exactly 64KB ok");
  ok(isBodyTooLarge("x".repeat(MAX_BODY_BYTES + 1)), "64KB+1 refused");
  ok(isBodyTooLarge("é".repeat(40000)), "multibyte measured in bytes");
  ok(isBodyTooLarge(null), "non-string refused");
}

// ── 5. floats refused ──────────────────────────────────────────────────────
{
  throws(
    () =>
      buildNotarizationPayload({ payload: { x: 1.5 }, attested_at: NOW }),
    "float payload refused"
  );
  throws(
    () => buildNotarizationPayload({ payload: [1.5], attested_at: NOW }),
    "float in array refused"
  );
  // integers fine
  buildNotarizationPayload({ payload: { x: 15 }, attested_at: NOW });
  assertions++;
}

// ── 6. missing signing key throws (route → 500, never unsigned) ─────────────
{
  const saved = process.env.TOLL_SIGNING_KEY;
  delete process.env.TOLL_SIGNING_KEY;
  throws(
    () => signTollPayload({ a: 1 }),
    /TOLL_SIGNING_KEY/,
    "missing toll key throws"
  );
  if (saved !== undefined) process.env.TOLL_SIGNING_KEY = saved;
}

// ── 7. shape classification ────────────────────────────────────────────────
{
  eq(classifyAttestShape({ payload: {} }), "notarization", "payload shape");
  eq(
    classifyAttestShape({ artifact: {}, claim: {} }),
    "exactness",
    "check shape"
  );
  eq(classifyAttestShape({}), "unknown", "empty body unknown");
  eq(
    classifyAttestShape({ payload: {}, artifact: {}, claim: {} }),
    "unknown",
    "both shapes unknown"
  );
  eq(classifyAttestShape(null), "unknown", "null unknown");
  eq(classifyAttestShape([1, 2]), "unknown", "array unknown");
}

// ── 8. route honesty: no billing/DB/metering touch ─────────────────────────
{
  const route = readFileSync(
    join(root, "src/app/api/toll/public/attest/route.ts"),
    "utf8"
  );
  for (const banned of [
    "getDB",
    "resolveTollPayer",
    "checkMonthlyUsage",
    "reportToll",
    "stripe",
    "toll_meter",
    "attestation_store",
    ".insert(",
    ".upsert(",
  ]) {
    ok(!route.includes(banned), `route must not contain ${banned}`);
  }
  ok(route.includes("signTollPayload"), "route signs via the shared signer");
  ok(route.includes("429"), "route returns 429 on rate limit");
}

console.log(`toll-public-attest selftest: ${assertions} assertions green`);
