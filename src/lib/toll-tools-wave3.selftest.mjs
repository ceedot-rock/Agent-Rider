/**
 * Toll Tools wave 3 selftest: cuni-proof, trustream-pack, chamber-seal,
 * awlpay-quote. Node builtins + the real cuni binary + real python3 only.
 * No secrets: chamber tests mint an ephemeral dev key with node:crypto —
 * ~/.config/slidphi-chamber is never touched.
 * Run: cd src && npm run selftest:toll-tools-3
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  tollSignerKid,
  verifyTollEnvelope,
  devTollKeypair,
} from "./toll-receipt-core.mjs";
import {
  ToolRunError,
  CUNI_SEATS,
  CUNI_SOURCE_MAX_BYTES,
  validateCuniProof,
  runCuniProof,
  TRUSTREAM_MAX_BYTES,
  validateTristreamPack,
  runTristreamPack,
  packRatioMilli,
  perMbUusdc,
  validateChamberSeal,
  runChamberSeal,
  AWL_RAILS,
  AWL_FEE_TIER,
  awlpayFeeUusdc,
  validateAwlpayQuote,
  runAwlpayQuote,
  CUNI_PROOF_PRICE_UUSDC,
  CHAMBER_SEAL_PRICE_UUSDC,
  AWL_PAY_QUOTE_PRICE_UUSDC,
} from "./toll-tools-wave3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CUNI_BIN = process.env.CUNI_BIN ?? join(here, "..", "cuni-bin", "cuni");
const TRUSTREAM_PY = process.env.TRUSTREAM_PY ?? join(here, "..", "vendor", "trustream.py");

let n = 0;
function ok(cond, label) {
  n++;
  assert.ok(cond, `assert#${n} ${label}`);
}

// Every detail object must survive the receipt pipeline: canonical JSON
// forbids floats and non-plain values, and input_hash has the right shape.
function assertReceiptSafe(out, label) {
  ok(/^[0-9a-f]{64}$/.test(out.input_hash.replace(/^sha256:/, "")), `${label}: input_hash sha256 hex`);
  const round = JSON.parse(canonicalJson(out.detail));
  assert.deepEqual(round, JSON.parse(JSON.stringify(out.detail)), `${label}: detail canonical-JSON safe`);
  n++;
}

// ── 1. cuni-proof validators ────────────────────────────────────────────
{
  const good = validateCuniProof({ source: "main() { print(1 + 2) }" });
  ok(good.ok, "cuni: valid source accepted");
  ok(JSON.stringify(good.value.seats) === JSON.stringify(["js", "py"]), "cuni: default seats js,py");
  const explicit = validateCuniProof({ source: "main() { print(1 + 2) }", seats: ["js"] });
  ok(explicit.ok && explicit.value.seats.length === 1, "cuni: explicit seats kept");
  const badSeat = validateCuniProof({ source: "main() { print(1) }", seats: ["wasm"] });
  ok(!badSeat.ok && badSeat.code === "seat_unavailable", "cuni: unknown seat → seat_unavailable");
  const emptySeat = validateCuniProof({ source: "main() { print(1) }", seats: [] });
  ok(!emptySeat.ok, "cuni: empty seats rejected");
  const noSrc = validateCuniProof({});
  ok(!noSrc.ok && noSrc.code === "bad_source", "cuni: missing source → bad_source");
  const tooBig = validateCuniProof({ source: "x".repeat(CUNI_SOURCE_MAX_BYTES + 1) });
  ok(!tooBig.ok && tooBig.code === "source_too_large", "cuni: >64KB source → source_too_large");
  const notObj = validateCuniProof(null);
  ok(!notObj.ok, "cuni: non-object body rejected");
}

// ── 2. cuni-proof runs (real binary) ────────────────────────────────────
{
  const budgetSrc = readFileSync(
    "/home/hatch/workspace/cuni-repo/examples/agent/budget.cuni",
    "utf8"
  );
  const v = validateCuniProof({ source: budgetSrc });
  ok(v.ok, "cuni: budget.cuni passes validation");
  const out = await runCuniProof(v.value, { binPath: CUNI_BIN });
  ok(out.result === "pass", "cuni: budget.cuni exactness PASS");
  ok(out.detail.langs === 2, "cuni: PASS (2 langs) parsed");
  ok(JSON.stringify(out.detail.seats_run) === JSON.stringify(["js", "py"]), "cuni: seats_run echoed");
  ok(out.detail.cuni_output_tail.includes("exactness: PASS"), "cuni: output tail carries the verdict");
  assertReceiptSafe(out, "cuni pass");

  const bad = validateCuniProof({ source: "this is not cuni {" });
  ok(bad.ok, "cuni: bad syntax passes validation (refuse is a runtime verdict)");
  const outBad = await runCuniProof(bad.value, { binPath: CUNI_BIN });
  ok(outBad.result === "refuse", "cuni: front-end refusal → refuse, not throw");
  ok(outBad.detail.langs === 0, "cuni: refuse reports langs 0");
  ok(outBad.detail.cuni_output_tail.includes("FAIL"), "cuni: refuse detail carries cuni's message");
  assertReceiptSafe(outBad, "cuni refuse");

  let missing = null;
  try {
    await runCuniProof({ source: "main() { print(1) }", seats: ["js"] }, { binPath: "/nonexistent/cuni" });
  } catch (e) { missing = e; }
  ok(missing instanceof ToolRunError && missing.code === "cuni_unavailable" && missing.status === 503, "cuni: missing binary → 503 cuni_unavailable");

  let timed = null;
  try {
    await runCuniProof({ source: budgetSrc, seats: ["js", "py"] }, { binPath: CUNI_BIN, timeoutMs: 1 });
  } catch (e) { timed = e; }
  ok(timed instanceof ToolRunError && timed.code === "cuni_timeout" && timed.status === 503, "cuni: timeout → 503 cuni_timeout");
}

// ── 3. trustream-pack validators ────────────────────────────────────────
{
  const good = validateTristreamPack({ data_base64: Buffer.from("hello trustream").toString("base64") });
  ok(good.ok && good.value.data.toString() === "hello trustream", "trustream: valid base64 accepted");
  const bad64 = validateTristreamPack({ data_base64: "!!!not-base64!!!" });
  ok(!bad64.ok && bad64.code === "bad_data_base64", "trustream: bad base64 → bad_data_base64");
  const missing2 = validateTristreamPack({});
  ok(!missing2.ok, "trustream: missing data_base64 rejected");
  const nonObj = validateTristreamPack("nope");
  ok(!nonObj.ok, "trustream: non-object body rejected");
}

// ── 4. trustream-pack runs (real python3) + roundtrip ───────────────────
function trustreamDecode(packed) {
  const driver = [
    "import sys, importlib.util",
    "spec = importlib.util.spec_from_file_location('trustream_lib', sys.argv[2])",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "sys.stdout.buffer.write(mod.decode_stream(sys.stdin.buffer.read()))",
  ].join("\n");
  const r = spawnSync("python3", ["-c", driver, "--", TRUSTREAM_PY], {
    input: packed,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, "decode driver rc 0");
  return Buffer.from(r.stdout);
}
{
  // mixed payload: zero tile, ramp tile, random tile
  const ramp = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) & 0xff));
  const zeros = Buffer.alloc(4096, 0);
  const rnd = createHash("sha256").update("seed").digest();
  const raw = Buffer.concat([zeros, ramp, Buffer.concat(Array(16).fill(rnd))]);
  const v = validateTristreamPack({ data_base64: raw.toString("base64") });
  ok(v.ok, "trustream: mixed payload validates");
  const out = await runTristreamPack(v.value, { trustreamPyPath: TRUSTREAM_PY });
  ok(out.result === "pass", "trustream: pack pass");
  ok(out.detail.bytes_in === raw.length, "trustream: bytes_in");
  ok(out.detail.bytes_out === out.packed.length, "trustream: bytes_out");
  ok(out.detail.bytes_out <= out.detail.bytes_in + 3 * out.detail.tile_count, "trustream: never expands beyond framing overhead");
  ok(out.detail.tile_count === Math.ceil(raw.length / 4096), "trustream: tile_count");
  ok(out.detail.ratio === packRatioMilli(raw.length, out.packed.length), "trustream: integer per-mille ratio");
  const back = trustreamDecode(out.packed);
  ok(back.equals(raw), "trustream: decode_stream roundtrip byte-identical");
  assertReceiptSafe(out, "trustream");

  let missing = null;
  try {
    await runTristreamPack({ data: Buffer.from("x") }, { pythonPath: "/nonexistent/python3" });
  } catch (e) { missing = e; }
  ok(missing instanceof ToolRunError && missing.code === "trustream_unavailable" && missing.status === 500, "trustream: missing python3 → 500 trustream_unavailable");

  let timed = null;
  try {
    await runTristreamPack({ data: Buffer.alloc(1024) }, { trustreamPyPath: TRUSTREAM_PY, timeoutMs: 1 });
  } catch (e) { timed = e; }
  ok(timed instanceof ToolRunError && timed.code === "trustream_timeout" && timed.status === 503, "trustream: timeout → 503 trustream_timeout");

  ok(perMbUusdc(0) === 1000, "perMbUusdc: 0 bytes → 1,000 minimum");
  ok(perMbUusdc(1_000_000) === 10_000, "perMbUusdc: 1MB → 10,000");
  ok(perMbUusdc(1_000_001) === 20_000, "perMbUusdc: 1MB+1 → 20,000");
}

// ── 5. chamber-seal validators + ephemeral-key run + fail-closed ────────
{
  const good = validateChamberSeal({ payload: { custody: "transfer", item: "doc-9" } });
  ok(good.ok, "chamber: valid payload accepted");
  ok(!validateChamberSeal({ payload: [1, 2] }).ok, "chamber: array payload rejected");
  ok(!validateChamberSeal({}).ok, "chamber: missing payload rejected");

  // ephemeral dev key — never touches real key material
  const { privateKey, publicKey } = devTollKeypair();
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const spkiPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const expectedKid = tollSignerKid(spkiPem);
  const saved = process.env.CHAMBER_SIGNING_KEY;
  process.env.CHAMBER_SIGNING_KEY = pem;
  try {
    const out = await runChamberSeal({ payload: { custody: "transfer", item: "doc-9" } });
    ok(out.result === "pass", "chamber: seal pass with dev key");
    const env = out.chamber_envelope;
    ok(env.alg === "ES256" && env.kid === expectedKid, "chamber: kid is RFC7638 thumbprint of the chamber public key");
    ok(env.payload.type === "chamber-seal" && env.payload.version === 1, "chamber: seal payload shape");
    ok(env.payload.issuer === "slid-phi-labs" && env.payload.custody === "lab", "chamber: issuer + custody");
    ok(env.payload.payload_hash === out.input_hash.slice("sha256:".length), "chamber: payload_hash matches input_hash");
    const expectHash = createHash("sha256")
      .update(canonicalJson({ custody: "transfer", item: "doc-9" }), "utf8")
      .digest("hex");
    ok(env.payload.payload_hash === expectHash, "chamber: payload_hash = sha256(canonical payload JSON)");
    ok(JSON.stringify(out.detail.chamber_envelope) === JSON.stringify(env), "chamber: envelope duplicated in receipt detail");
    // verify with the chamber public key
    const jwk = publicKey.export({ format: "jwk" });
    const got = verifyTollEnvelope(env, { [expectedKid]: { ...jwk, kid: expectedKid } });
    ok(got.type === "chamber-seal", "chamber: envelope verifies under chamber public key");
    assertReceiptSafe(out, "chamber");
  } finally {
    if (saved === undefined) delete process.env.CHAMBER_SIGNING_KEY;
    else process.env.CHAMBER_SIGNING_KEY = saved;
  }

  // fail closed without the key (expected production state)
  const saved2 = process.env.CHAMBER_SIGNING_KEY;
  delete process.env.CHAMBER_SIGNING_KEY;
  let closed = null;
  try {
    await runChamberSeal({ payload: { a: 1 } });
  } catch (e) { closed = e; }
  finally { if (saved2 !== undefined) process.env.CHAMBER_SIGNING_KEY = saved2; }
  ok(closed instanceof ToolRunError && closed.code === "chamber_key_unavailable" && closed.status === 503, "chamber: absent key → 503 chamber_key_unavailable, never a fake seal");
}

// ── 6. awlpay-quote validators + integer math ───────────────────────────
{
  ok(validateAwlpayQuote({ amount_uusdc: 1_000_000, rail: "tron" }).ok, "awlpay: valid quote accepted");
  ok(!validateAwlpayQuote({ amount_uusdc: 0, rail: "tron" }).ok, "awlpay: zero amount → bad_amount");
  ok(!validateAwlpayQuote({ amount_uusdc: 1.5, rail: "tron" }).ok, "awlpay: fractional amount → bad_amount");
  ok(!validateAwlpayQuote({ amount_uusdc: 100, rail: "eth" }).ok, "awlpay: bad rail → bad_rail");
  ok(AWL_RAILS.length === 6 && AWL_RAILS.includes("bitcoin"), "awlpay: six rails");

  ok(awlpayFeeUusdc(1_000_000) === 5_000, "awlpay: 1_000_000 → fee 5_000 (0.5%)");
  ok(awlpayFeeUusdc(1) === 1, "awlpay: 1 → fee 1 (ceil)");
  // ceil proof without floats: fee*1000 >= amount*5 and (fee-1)*1000 < amount*5
  for (const amt of [1, 2, 333, 999, 1000, 123456789]) {
    const fee = awlpayFeeUusdc(amt);
    ok(fee * 1000 >= amt * 5 && (fee - 1) * 1000 < amt * 5, `awlpay: fee is exact ceil(0.5%) for ${amt}`);
  }
  const out = runAwlpayQuote({ amount_uusdc: 1_000_000, rail: "tron" });
  ok(out.result === "pass", "awlpay: quote pass");
  ok(out.detail.fee_tier === AWL_FEE_TIER, "awlpay: fee_tier free-0.5pct");
  ok(out.detail.fee_uusdc === 5_000 && out.detail.net_uusdc === 995_000, "awlpay: net = amount - fee");
  ok(out.detail.amount_uusdc + 0 === 1_000_000, "awlpay: amount echoed");
  assertReceiptSafe(out, "awlpay");

  const tiny = runAwlpayQuote({ amount_uusdc: 1, rail: "base" });
  ok(tiny.detail.fee_uusdc === 1 && tiny.detail.net_uusdc === 0, "awlpay: 1 → fee 1, net 0");
}

// ── 7. prices ───────────────────────────────────────────────────────────
{
  ok(CUNI_PROOF_PRICE_UUSDC === 100_000, "price: cuni-proof 100_000");
  ok(CHAMBER_SEAL_PRICE_UUSDC === 20_000, "price: chamber-seal 20_000");
  ok(AWL_PAY_QUOTE_PRICE_UUSDC === 5_000, "price: awlpay-quote 5_000");
}

console.log(`toll-tools-wave3 selftest: ${n} assertions green`);
