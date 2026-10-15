/**
 * Selftest for the Toll Tools Wave 1 core (src/lib/toll-tools-wave1.mjs).
 *
 * Run: cd src && node lib/toll-tools-wave1.selftest.mjs
 * (PCC roundtrip sections need the local codec binary; set
 *  PCC_BIN=<worktree>/src/pcc-bin/savant_codec2.)
 *
 * ≥30 assertions. Node builtins only — no side effects beyond spawning
 * the local PCC binary in a temp dir.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PCC_MAX_DECODED_BYTES,
  PCC_ENCODE_TIMEOUT_MS,
  PCC_DECODE_TIMEOUT_MS,
  PCC_MAX_BLOB_BYTES,
  ATTEST_MAX_BODY_BYTES,
  ToolInputError,
  ToolDependencyError,
  canonicalInputBytes,
  newReceiptId,
  validatePccCompress,
  runPccCompress,
  validatePccVerify,
  runPccVerify,
  validateAttestNotarize,
  runAttestNotarize,
  validateAttestExactness,
  runAttestExactness,
} from "./toll-tools-wave1.mjs";

import { buildNotarizationPayload } from "./toll-public-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let n = 0;
function ok(cond, label) {
  n += 1;
  assert.ok(cond, label);
}

// ── limits constants ────────────────────────────────────────────────────
ok(PCC_MAX_DECODED_BYTES === 4 * 1024 * 1024, "compress cap is 4MB");
ok(PCC_ENCODE_TIMEOUT_MS === 90_000, "encode timeout 90s");
ok(PCC_DECODE_TIMEOUT_MS === 60_000, "decode timeout 60s");
ok(PCC_MAX_BLOB_BYTES === 8 * 1024 * 1024, "verify blob cap 8MB");
ok(ATTEST_MAX_BODY_BYTES === 64 * 1024, "attest body cap 64KB");

// ── validatePccCompress ─────────────────────────────────────────────────
{
  const good = Buffer.from("hello world").toString("base64");
  const v = validatePccCompress({ data_base64: good });
  ok(v.ok === true, "compress validator accepts good input");
  ok(v.value.decoded.length === 11, "compress validator decodes bytes");
  ok(v.detail.bytes_in === 11, "compress validator detail bytes_in");
  ok(validatePccCompress(null).ok === false, "compress rejects null body");
  ok(validatePccCompress([]).ok === false, "compress rejects array body");
  ok(validatePccCompress({}).ok === false, "compress rejects missing data_base64");
  ok(validatePccCompress({ data_base64: "!!!not-base64!!!" }).ok === false, "compress rejects bad base64");
  ok(validatePccCompress({ data_base64: "" }).ok === false, "compress rejects empty base64");
  ok(validatePccCompress({ data_base64: Buffer.alloc(0).toString("base64") }).ok === false, "compress rejects zero-byte input");
  const tooBig = randomBytes(PCC_MAX_DECODED_BYTES + 1).toString("base64");
  const tv = validatePccCompress({ data_base64: tooBig });
  ok(tv.ok === false && tv.code === "input_too_large", "compress rejects over-cap input");
}

// ── pricing math (perMbUusdc boundaries) ────────────────────────────────
// perMbUusdc lives in toll-tools.ts; lock the formula here AND confirm the
// live implementation carries the identical arithmetic.
function perMbUusdc(bytesIn) {
  return Math.max(1_000, Math.ceil(bytesIn / 1_000_000) * 10_000);
}
ok(perMbUusdc(0) === 1_000, "pricing: 0 bytes hits the 1,000 minimum floor");
ok(perMbUusdc(1) === 10_000, "pricing: 1 byte rounds up to 1MB = 10,000");
ok(perMbUusdc(999_999) === 10_000, "pricing: just under 1MB rounds to 10,000");
ok(perMbUusdc(1_000_000) === 10_000, "pricing: exactly 1MB = 10,000");
ok(perMbUusdc(1_000_001) === 20_000, "pricing: 1MB+1 rounds up to 2MB");
ok(perMbUusdc(4_000_000) === 40_000, "pricing: 4MB cap = 40,000 ($0.04)");
{
  const src = readFileSync(join(__dirname, "toll-tools.ts"), "utf8");
  ok(
    src.includes("Math.max(1_000, Math.ceil(bytesIn / 1_000_000) * 10_000)"),
    "live perMbUusdc in toll-tools.ts matches the tested formula"
  );
}

// ── real-binary PCC roundtrip (needs PCC_BIN) ───────────────────────────
const PCC = process.env.PCC_BIN ?? "/app/pcc-bin/savant_codec2";
let haveBinary = true;
try {
  execFileSync(PCC, ["--help"], { timeout: 10_000, stdio: "pipe" });
} catch (e) {
  // --help may exit nonzero on this binary; what matters is ENOENT.
  haveBinary = e?.code !== "ENOENT";
}
if (!haveBinary) {
  console.log("PCC binary missing at", PCC, "— skipping binary tests");
} else {
  // Compressible 16KB input: bake-off should produce an output file.
  const raw = Buffer.from("agent-rider toll tools wave1 · ".repeat(512));
  const dir = mkdtempSync(join(tmpdir(), "wave1self-"));
  try {
    writeFileSync(join(dir, "in.bin"), raw);
    execFileSync(PCC, ["encode_whole", join(dir, "in.bin"), join(dir, "out.pcc")], {
      timeout: 120_000,
      stdio: "pipe",
    });
    const blob = readFileSync(join(dir, "out.pcc"));
    ok(blob.length > 0, "encode_whole produces output for compressible input");

    // runPccCompress pass path
    const v = validatePccCompress({ data_base64: raw.toString("base64") });
    ok(v.ok === true, "compress validator accepts roundtrip input");
    const res = await runPccCompress(v.value);
    ok(res.result === "pass", "runPccCompress passes on compressible input");
    ok(res.detail.bytes_in === raw.length, "compress detail bytes_in matches");
    ok(res.detail.bytes_out === blob.length, "compress detail bytes_out matches real binary");
    ok(res.detail.sha256_in === createHash("sha256").update(raw).digest("hex"), "compress sha256_in correct");
    ok(res.detail.sha256_out === createHash("sha256").update(blob).digest("hex"), "compress sha256_out correct");
    ok(typeof res.blob_base64 === "string" && Buffer.from(res.blob_base64, "base64").equals(blob), "compress returns the actual blob bytes (response body, not receipt)");
    ok(res.detail.ratio < 1000, "compress ratio < 1000 (per-mille) on compressible input");
    ok(Number.isInteger(res.detail.ratio), "compress ratio is an integer (no floats in receipts)");

    // runPccVerify pass path (true end-to-end: real blob through the tool)
    const expected = createHash("sha256").update(raw).digest("hex");
    const vv = validatePccVerify({
      blob_base64: blob.toString("base64"),
      orig_size: raw.length,
      expected_sha256: expected,
    });
    ok(vv.ok === true, "verify validator accepts good input");
    const vres = await runPccVerify(vv.value);
    ok(vres.result === "pass", "runPccVerify passes on true roundtrip");
    ok(vres.detail.sha256 === expected, "verify detail sha256 matches expected");

    // runPccVerify refuse path (wrong expected hash)
    const vvBad = validatePccVerify({
      blob_base64: blob.toString("base64"),
      orig_size: raw.length,
      expected_sha256: "00".repeat(32),
    });
    ok(vvBad.ok === true, "verify validator accepts wrong-hash input shape");
    const vresBad = await runPccVerify(vvBad.value);
    ok(vresBad.result === "refuse", "runPccVerify refuses on sha256 mismatch");
    ok(vresBad.detail.refusal === "sha256_mismatch", "verify refuse names sha256_mismatch");

    // runPccCompress refuse path (incompressible random input → no output file)
    const noise = randomBytes(4096);
    const nv = validatePccCompress({ data_base64: noise.toString("base64") });
    ok(nv.ok === true, "compress validator accepts random input shape");
    const nres = await runPccCompress(nv.value);
    ok(nres.result === "refuse", "runPccCompress refuses incompressible input");
    ok(nres.detail.refusal === "codec_declined", "compress refuse names codec_declined");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── validatePccVerify shapes ────────────────────────────────────────────
{
  ok(validatePccVerify(null).ok === false, "verify rejects null body");
  ok(validatePccVerify({ blob_base64: "eA==", orig_size: 1 }).ok === false, "verify rejects missing expected_sha256");
  ok(
    validatePccVerify({ blob_base64: "eA==", orig_size: 0, expected_sha256: "ab".repeat(32) }).code === "bad_orig_size",
    "verify rejects orig_size 0"
  );
  ok(
    validatePccVerify({ blob_base64: "eA==", orig_size: 1.5, expected_sha256: "ab".repeat(32) }).code === "bad_orig_size",
    "verify rejects non-integer orig_size"
  );
  ok(
    validatePccVerify({ blob_base64: "eA==", orig_size: 1, expected_sha256: "zzz" }).code === "bad_expected_sha256",
    "verify rejects short sha256"
  );
  ok(
    validatePccVerify({ blob_base64: "!!!", orig_size: 1, expected_sha256: "ab".repeat(32) }).code === "bad_blob_base64",
    "verify rejects bad base64"
  );
}

// ── attest-notarize ─────────────────────────────────────────────────────
{
  const v = validateAttestNotarize({ payload: { a: 1, note: "wave1" } });
  ok(v.ok === true, "notarize validator accepts plain object payload");
  const res = runAttestNotarize(v.value);
  ok(res.result === "pass", "notarize runner passes");
  ok(typeof res.detail.payload_hash === "string" && res.detail.payload_hash.length === 64, "notarize detail has payload_hash");
  ok(res.detail.mode === "notarization", "notarize detail mode set");
  // Same hash as the shared builder → we are metering, not reimplementing.
  const direct = buildNotarizationPayload({ payload: { a: 1, note: "wave1" }, attested_at: res.detail.attested_at });
  ok(direct.payload_hash === res.detail.payload_hash, "notarize hash equals shared builder output");
  ok(validateAttestNotarize({ payload: [1, 2] }).code === "bad_payload", "notarize rejects array payload");
  ok(validateAttestNotarize({ payload: null }).code === "bad_payload", "notarize rejects null payload");
  ok(validateAttestNotarize(null).code === "malformed_request", "notarize rejects null body");
  // Floats refused via the shared builder contract.
  const fv = validateAttestNotarize({ payload: { x: 1.5 } });
  let floatErr = null;
  try {
    runAttestNotarize(fv.value);
  } catch (e) {
    floatErr = e;
  }
  ok(floatErr instanceof ToolInputError && floatErr.code === "floats_refused", "notarize refuses floats");
  // 64KB body cap.
  const big = validateAttestNotarize({ payload: { s: "x".repeat(70_000) } });
  ok(big.ok === false && big.code === "body_too_large", "notarize enforces 64KB cap");
}

// ── attest-exactness ────────────────────────────────────────────────────
{
  ok(validateAttestExactness(null).code === "malformed_request", "exactness rejects null body");
  ok(validateAttestExactness({ artifact: [1], claim: {} }).code === "bad_artifact", "exactness rejects array artifact");
  ok(validateAttestExactness({ artifact: {}, claim: [1] }).code === "bad_claim", "exactness rejects array claim");
  const artifact = { program: "add", inputs: [1, 2] };
  // Refuse: wrong stdout.
  const rv = validateAttestExactness({ artifact, claim: { stdout: "definitely-wrong" } });
  ok(rv.ok === true, "exactness validator accepts shape");
  const rres = runAttestExactness(rv.value);
  ok(rres.result === "refuse", "exactness refuses wrong stdout");
  ok(typeof rres.detail.artifact_hash === "string", "exactness detail has artifact_hash");
  ok(rres.detail.result === "refuse", "exactness detail echoes refuse");
  // Pass: claim.stdout taken from a seat's simulated output.
  const seatOut = rres.detail.per_seat_stdout["seat-a"];
  const pv = validateAttestExactness({ artifact, claim: { stdout: seatOut } });
  const pres = runAttestExactness(pv.value);
  ok(pres.result === "pass", "exactness passes on matching stdout");
  // OracleError path: claim without string stdout → run throws (route maps to 400).
  const ov = validateAttestExactness({ artifact, claim: { stdout: 42 } });
  let oracleErr = null;
  try {
    runAttestExactness(ov.value);
  } catch (e) {
    oracleErr = e;
  }
  ok(oracleErr !== null && oracleErr.constructor.name === "OracleError", "exactness run throws OracleError on bad claim");
}

// ── receipt plumbing helpers ────────────────────────────────────────────
{
  ok(
    canonicalInputBytes("pcc-compress", "abc").toString("utf8").startsWith("pcc-compress:"),
    "canonicalInputBytes prefixes tool marker"
  );
  const id1 = newReceiptId();
  const id2 = newReceiptId();
  ok(id1.startsWith("tool_") && id1.length === 21, "receipt id shape tool_<16hex>");
  ok(id1 !== id2, "receipt ids unique");
}

// ── route contract: every new route carries the required response fields ─
{
  const routeDir = join(__dirname, "../app/api/toll/tools");
  const required = ["live:", "metered:", "price_usd", "receipt_id", "envelope", "usage:", "payer:"];
  for (const tool of ["pcc-compress", "pcc-verify", "attest-notarize", "attest-exactness"]) {
    const src = readFileSync(join(routeDir, tool, "route.ts"), "utf8");
    for (const f of required) ok(src.includes(f), `${tool} route includes response field ${f}`);
    ok(src.includes("isTollToolsLive()"), `${tool} route checks flag first`);
    ok(src.includes("sandboxTool(req,"), `${tool} route branches to sandbox`);
    ok(src.includes("signing_unavailable"), `${tool} route fails closed without signing key`);
    ok(src.includes("TOOL_CORS_HEADERS"), `${tool} route uses TOOL_CORS_HEADERS`);
    ok(src.includes("checkMonthlyUsage(`tools:"), `${tool} route meters monthly usage`);
    ok(src.includes("billed: false"), `${tool} route reports billed:false (no Stripe)`);
  }
  // Receipt payload shape in the shared builder (toll-tools.ts).
  const toolsSrc = readFileSync(join(__dirname, "toll-tools.ts"), "utf8");
  for (const f of ['type: "tool-receipt"', "version: 1", "tool:", "payer_id", "price_uusdc", "result:", "input_hash", "detail:"]) {
    ok(toolsSrc.includes(f), `buildToolReceiptPayload shape includes ${f}`);
  }
  // attest-notarize route must not touch the free public endpoint: it makes
  // no network calls at all (it validates itself and calls the shared
  // builder directly).
  const nzSrc = readFileSync(join(routeDir, "attest-notarize", "route.ts"), "utf8");
  ok(!/fetch\s*\(/.test(nzSrc), "attest-notarize makes no network calls");
  ok(nzSrc.includes("runAttestNotarize"), "attest-notarize uses its own runner");
}

console.log(`toll-tools-wave1.selftest: ok (${n} assertions)`);
