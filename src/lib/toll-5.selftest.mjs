/**
 * Toll 5 — verification oracle / exactness attestations.
 * Ports ~/workspace/rider-toll/tollkeeper/test_oracle.py edge cases:
 * pass path, refuse path, malformed artifact/claim, result validation,
 * attestation_id determinism, envelope round-trip with devTollKeypair,
 * tamper evidence. Plus flag + route source-shape assertions.
 * No network, no secrets, no DB. Run: cd src && npm run selftest:toll-5
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  devTollKeypair,
  jwksForTest,
  signTollPayload,
  TollReceiptError,
  verifyTollEnvelope,
} from "./toll-receipt-core.mjs";
import {
  CHECK_TOLL_UUSDC,
  OracleError,
  POLICY_REF,
  ORACLE_ID,
  DEFAULT_SEATS,
  artifactHashOf,
  buildAttestationPayload,
  defaultExactness,
  validateCheckResult,
} from "./toll-5-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

let n = 0;
function ok(cond, msg) {
  n++;
  assert.ok(cond, msg);
}
function eq(a, b, msg) {
  n++;
  assert.equal(a, b, msg);
}
function throwsOracle(fn, msg) {
  n++;
  assert.throws(fn, (e) => e instanceof OracleError, msg);
}

const artifact = { program: "dice", input: "seed=7" };
// Simulated per-seat stdout: sha256 of canonical({artifact}), seat id NOT in hash.
const goodStdout = createHash("sha256")
  .update(canonicalJson({ artifact }), "utf8")
  .digest("hex");
const key = devTollKeypair("dev-toll-5");
const jwks = jwksForTest(key.publicKey, key.kid);
const now = 1759000000;

function submit(claim) {
  const checkResult = validateCheckResult(defaultExactness(artifact, claim));
  const { attestation_id, payload } = buildAttestationPayload({
    artifact,
    claim,
    checkResult,
    checked_at: now,
  });
  return { envelope: signTollPayload(payload, { privateKey: key.privateKey, kid: key.kid }), attestation_id, payload, checkResult };
}

// ── Stub exactness: pass path ────────────────────────────────────────────
{
  const { envelope, attestation_id } = submit({ stdout: goodStdout });
  const payload = verifyTollEnvelope(envelope, jwks);
  eq(payload.type, "exactness-attestation", "attestation type");
  eq(payload.version, 1, "attestation version");
  eq(payload.result, "pass", "pass result");
  eq(payload.policy_ref, POLICY_REF, "policy_ref");
  eq(payload.oracle, ORACLE_ID, "oracle id");
  eq(payload.artifact_hash, artifactHashOf(artifact), "artifact hash matches");
  eq(JSON.stringify(payload.seats), JSON.stringify(["seat-a", "seat-b"]), "default seats");
  ok(payload.attestation_id.startsWith("at_"), "attestation_id prefix");
  eq(payload.attestation_id, attestation_id, "attestation_id matches builder");
  eq(payload.checked_at, now, "checked_at passthrough");
  ok(/^[0-9a-f]{64}$/.test(payload.artifact_hash), "artifact_hash is sha256 hex");
}

// ── Stub exactness: refuse path ──────────────────────────────────────────
{
  const { envelope } = submit({ stdout: "tampered-output" });
  const payload = verifyTollEnvelope(envelope, jwks);
  eq(payload.result, "refuse", "mismatch → refuse (not an error)");
}

// ── defaultExactness shape ───────────────────────────────────────────────
{
  const res = defaultExactness(artifact, { stdout: goodStdout });
  eq(res.result, "pass", "shape: pass");
  eq(res.detail.seats_agree, true, "shape: seats_agree");
  eq(res.detail.claim_stdout, goodStdout, "shape: claim_stdout echoed");
  eq(JSON.stringify(Object.keys(res.detail.per_seat_stdout).sort()), JSON.stringify(["seat-a", "seat-b"]), "shape: per_seat_stdout keys");
  const res2 = defaultExactness(artifact, { stdout: "nope" });
  eq(res2.result, "refuse", "shape: refuse on mismatch");
  // Seat id deliberately NOT in the hash: both seats share one stdout.
  eq(res.detail.per_seat_stdout["seat-a"], res.detail.per_seat_stdout["seat-b"], "seat id not in stdout hash");
}

// ── Malformed artifact/claim: OracleError (fail closed) ──────────────────
throwsOracle(() => defaultExactness(null, { stdout: "x" }), "null artifact");
throwsOracle(() => defaultExactness("x", { stdout: "x" }), "string artifact");
throwsOracle(() => defaultExactness([1], { stdout: "x" }), "array artifact");
throwsOracle(() => defaultExactness(42, { stdout: "x" }), "number artifact");
throwsOracle(() => defaultExactness(artifact, null), "null claim");
throwsOracle(() => defaultExactness(artifact, "x"), "string claim");
throwsOracle(() => defaultExactness(artifact, {}), "claim without stdout");
throwsOracle(() => defaultExactness(artifact, { stdout: 42 }), "non-string stdout");
throwsOracle(() => defaultExactness(artifact, { stdout: ["x"] }), "array stdout");
throwsOracle(() => artifactHashOf(null), "artifactHashOf rejects non-dict");
ok(new OracleError("x") instanceof Error, "OracleError is an Error");

// ── validateCheckResult: every contract breach refused ───────────────────
throwsOracle(() => validateCheckResult(null), "non-dict result");
throwsOracle(() => validateCheckResult("pass"), "string result");
throwsOracle(() => validateCheckResult({ result: "maybe", seats: ["s"], detail: {} }), "'maybe' result");
throwsOracle(() => validateCheckResult({ result: "pass", seats: [], detail: {} }), "empty seats");
throwsOracle(() => validateCheckResult({ result: "pass", detail: {} }), "missing seats");
throwsOracle(() => validateCheckResult({ result: "pass", seats: "seat-a", detail: {} }), "non-list seats");
throwsOracle(() => validateCheckResult({ result: "refuse", seats: ["s"] }), "missing detail");
{
  const good = { result: "pass", seats: ["seat-a", "seat-b"], detail: { x: 1 } };
  eq(validateCheckResult(good), good, "valid result passes through");
  eq(validateCheckResult({ result: "refuse", seats: ["gate"], detail: {} }).result, "refuse", "refuse passes validation");
}

// ── attestation_id determinism ───────────────────────────────────────────
{
  const a1 = buildAttestationPayload({ artifact, claim: { stdout: goodStdout }, checkResult: { result: "pass", seats: ["seat-a", "seat-b"] }, checked_at: now });
  const a2 = buildAttestationPayload({ artifact, claim: { stdout: goodStdout }, checkResult: { result: "pass", seats: ["seat-a", "seat-b"] }, checked_at: now });
  eq(a1.attestation_id, a2.attestation_id, "attestation_id deterministic for same core");
  const a3 = buildAttestationPayload({ artifact, claim: { stdout: goodStdout }, checkResult: { result: "pass", seats: ["seat-a", "seat-b"] }, checked_at: now + 1 });
  ok(a1.attestation_id !== a3.attestation_id, "checked_at feeds attestation_id");
  const a4 = buildAttestationPayload({ artifact, claim: { stdout: "tampered" }, checkResult: { result: "refuse", seats: ["seat-a", "seat-b"] }, checked_at: now });
  ok(a1.attestation_id !== a4.attestation_id, "claim feeds attestation_id");
  ok(/^at_[0-9a-f]{16}$/.test(a1.attestation_id), "attestation_id format at_<16 hex>");
  throwsOracle(() => buildAttestationPayload({ artifact, claim: { stdout: "x" }, checkResult: { result: "pass", seats: ["s"] }, checked_at: 1.5 }), "non-integer checked_at");
}

// ── Envelope round-trip + tamper evidence ────────────────────────────────
{
  const { envelope, payload } = submit({ stdout: goodStdout });
  const roundTripped = verifyTollEnvelope(envelope, jwks);
  eq(JSON.stringify(roundTripped), JSON.stringify(payload), "envelope round-trips payload byte-identically");
  const evil = JSON.parse(JSON.stringify(envelope));
  evil.payload.seats = ["evil-seat"];
  n++;
  assert.throws(() => verifyTollEnvelope(evil, jwks), (e) => e instanceof TollReceiptError, "tampered payload fails verify");
  const evil2 = JSON.parse(JSON.stringify(envelope));
  evil2.payload.claim.stdout = "forged-claim";
  n++;
  assert.throws(() => verifyTollEnvelope(evil2, jwks), (e) => e instanceof TollReceiptError, "forged claim stdout fails verify");
}

// ── Money: integer micro-USDC, no floats ────────────────────────────────
eq(CHECK_TOLL_UUSDC, 100_000, "10c = 100_000 micro-USDC");
ok(Number.isInteger(CHECK_TOLL_UUSDC), "toll is an integer");
eq(JSON.stringify(DEFAULT_SEATS), JSON.stringify(["seat-a", "seat-b"]), "default seats const");
eq(POLICY_REF, "tollkeeper.oracle.exactness/v1", "policy ref");
eq(ORACLE_ID, "tollkeeper-oracle/v1", "oracle id");

// ── Flags: source-shape (default OFF, env flips live) ────────────────────
{
  const flags = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
  ok(/isToll5CheckLive/.test(flags), "flag fn present");
  ok(/envFlagOn\("TOLL5_CHECK_LIVE"\)/.test(flags), "env TOLL5_CHECK_LIVE flips live");
  ok(/TOLL5_CHECK_OFF_BODY/.test(flags), "off body present");
  ok(/toll5_check_off/.test(flags), "off error code");
  ok(/price_usd_when_live:\s*0\.1/.test(flags), "off body price 0.1");
  ok(/POST \/api\/toll\/v5\/check/.test(flags), "off body metered path");
}

// ── Route: source-shape assertions ──────────────────────────────────────
{
  const route = readFileSync(join(__dirname, "../app/api/toll/v5/check/route.ts"), "utf8");
  ok(/isToll5CheckLive/.test(route), "route: flag gate");
  ok(/TOLL5_CHECK_OFF_BODY/.test(route), "route: off body");
  ok(/status:\s*503/.test(route), "route: 503 when flag off");
  ok(/resolveTollPayer/.test(route), "route: payer resolution");
  ok(/isTollPayerOk/.test(route), "route: payer ok check");
  ok(/checkMonthlyUsage/.test(route), "route: monthly usage");
  ok(/toll5_check:\$\{payer\.payer_id\}/.test(route), "route: usage key namespaced");
  ok(/reportToll5Check/.test(route), "route: stripe meter report");
  ok(/overLimit && payer\.stripe_customer_id/.test(route), "route: report only when over limit with customer");
  ok(/signTollPayload/.test(route), "route: lab-sealed envelope");
  ok(/toll_attestations/.test(route), "route: attestation row write");
  ok(/attestation_store_failed/.test(route), "route: row write fail closed");
  ok(/toll_meter/.test(route), "route: meter ledger write");
  ok(/oracle/.test(route) && /CHECK_TOLL_UUSDC/.test(route), "route: meter module oracle + toll const");
  ok(/malformed_check_request/.test(route), "route: 400 fail-closed on malformed input");
  ok(/OracleError/.test(route), "route: OracleError → 400");
  ok(/t5_\$\{/.test(route), "route: t5_ receipt id");
  ok(/price_usd:\s*PRICE_USD/.test(route), "route: price_usd 0.1");
  ok(/refuse/.test(route), "route: refuse outcome present");
  ok(/CuNi/.test(route), "route: CuNi plug-in comment present");
  ok(/plugs in/.test(route) || /plug-in/i.test(route), "route: plug-in point marked");
  ok(/OPTIONS/.test(route) && /Access-Control-Allow-Origin/.test(route), "route: CORS + OPTIONS");
  ok(/receipt_id/.test(route) && /attestation_id/.test(route) && /artifact_hash/.test(route), "route: response carries receipt/attestation/hash");
}

console.log(`toll-5.selftest: ok (${n} assertions — pass/refuse paths, malformed input, result validation, id determinism, envelope round-trip, flags, route shape)`);
