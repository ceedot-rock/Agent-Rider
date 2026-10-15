/**
 * Toll Tools wave 3 — pure core for cuni-proof, trustream-pack,
 * chamber-seal, awlpay-quote. Selftest-importable, node:crypto only
 * (+ cuni / python3 subprocesses for the two subprocess tools).
 *
 * Each tool exposes a validate/run pair:
 *   validateX(body) -> { ok:true, value } | { ok:false, code, reason }
 *   runX(value, opts) -> Promise<{ result, detail, input_hash, ... }>
 * Runners throw ToolRunError carrying { code, status } for named
 * dependency failures (500/503); anything else is unexpected.
 *
 * Pricing (micro-USDC integers; 1 USDC = 1,000,000):
 *   cuni-proof      100_000 flat
 *   trustream-pack  perMbUusdc(bytes_in) — same one-liner as toll-tools.ts
 *   chamber-seal     20_000 flat
 *   awlpay-quote      5_000 flat
 */

import { spawnSync } from "node:child_process";
import {
  accessSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  constants as fsConstants,
} from "node:fs";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  signTollPayload,
  tollSignerKid,
} from "./toll-receipt-core.mjs";

// ── Errors ──────────────────────────────────────────────────────────────

/** Named tool failure: { code, status } — 400s are validator results,
 *  runners throw 500/503 ToolRunErrors for dependency failures. */
export class ToolRunError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "ToolRunError";
    this.code = code;
    this.status = status;
  }
}

// ── Pricing ─────────────────────────────────────────────────────────────

export const CUNI_PROOF_PRICE_UUSDC = 100_000;
export const CHAMBER_SEAL_PRICE_UUSDC = 20_000;
export const AWL_PAY_QUOTE_PRICE_UUSDC = 5_000;

/** Same one-liner as toll-tools.ts (TS) — reimplemented here for .mjs use. */
export function perMbUusdc(bytesIn) {
  return Math.max(1_000, Math.ceil(bytesIn / 1_000_000) * 10_000);
}

// ── Hashing ─────────────────────────────────────────────────────────────

function sha256HexBytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function sha256HexUtf8(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── 1. cuni-proof ───────────────────────────────────────────────────────

export const CUNI_SEATS = ["js", "py"];
export const CUNI_SOURCE_MAX_BYTES = 64 * 1024;
export const CUNI_TIMEOUT_MS = 120_000;

/**
 * POST { source, seats? } — seats default to ["js","py"], the toolchains
 * that exist in the image. Any other seat → 400 seat_unavailable.
 */
export function validateCuniProof(body) {
  if (!isPlainObject(body))
    return { ok: false, code: "bad_request", reason: "body must be an object" };
  const { source, seats } = body;
  if (typeof source !== "string" || source.length === 0)
    return { ok: false, code: "bad_source", reason: "source must be a non-empty string" };
  if (Buffer.byteLength(source, "utf8") > CUNI_SOURCE_MAX_BYTES)
    return { ok: false, code: "source_too_large", reason: `source max ${CUNI_SOURCE_MAX_BYTES} bytes` };
  let seatList = CUNI_SEATS;
  if (seats !== undefined) {
    if (!Array.isArray(seats) || seats.length === 0 || seats.length > 10)
      return { ok: false, code: "bad_seats", reason: "seats must be a non-empty array (max 10)" };
    for (const s of seats) {
      if (typeof s !== "string" || !CUNI_SEATS.includes(s))
        return { ok: false, code: "seat_unavailable", reason: `seat ${JSON.stringify(s)} is not available (image has js,py)` };
    }
    seatList = [...seats];
  }
  return { ok: true, value: { source, seats: seatList } };
}

/**
 * Runs `cuni check <tmpfile> --only <seats> --receipt` with a 120s timeout.
 * result "pass" on `exactness: PASS (N langs)`; "refuse" on
 * `exactness: FAIL` / front-end refusal — STILL returns the outcome (the
 * route wraps it in a signed receipt attesting the negative outcome).
 * Missing/unexecutable binary → 503 cuni_unavailable;
 * timeout → 503 cuni_timeout.
 */
export async function runCuniProof(input, opts = {}) {
  const bin = opts.binPath ?? process.env.CUNI_BIN ?? "/app/cuni-bin/cuni";
  try {
    accessSync(bin, fsConstants.X_OK);
  } catch {
    throw new ToolRunError(
      "cuni_unavailable",
      "CuNi binary missing or not executable",
      503
    );
  }
  const seats = input.seats;
  const seatsCsv = seats.join(",");
  const dir = mkdtempSync(join(tmpdir(), "cuni-proof-"));
  try {
    const file = join(dir, "proof.cuni");
    writeFileSync(file, input.source, "utf8");
    const timeoutMs = opts.timeoutMs ?? CUNI_TIMEOUT_MS;
    const res = spawnSync(bin, ["check", file, "--only", seatsCsv, "--receipt"], {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (res.error) {
      if (res.error.code === "ETIMEDOUT")
        throw new ToolRunError("cuni_timeout", "CuNi check timed out", 503);
      throw new ToolRunError(
        "cuni_unavailable",
        `CuNi failed to run: ${res.error.message}`,
        503
      );
    }
    const out = String(res.stdout ?? "") + String(res.stderr ?? "");
    const passM = out.match(/exactness:\s*PASS\s*\(\s*(\d+)\s*langs?\)/i);
    const failM = /exactness:\s*FAIL/i.test(out);
    const result = passM && !failM ? "pass" : "refuse";
    const langs = passM ? Number(passM[1]) : 0;
    const tail = out.trim().split("\n").slice(-12).join("\n").slice(0, 2000);
    return {
      result,
      detail: { seats_run: seats, langs, cuni_output_tail: tail },
      input_hash: "sha256:" + sha256HexUtf8(canonicalJson({ source: input.source, seats })),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. trustream-pack ───────────────────────────────────────────────────

export const TRUSTREAM_MAX_BYTES = 8 * 1024 * 1024;
export const TRUSTREAM_TIMEOUT_MS = 60_000;
export const TRUSTREAM_TILE = 4096;

/**
 * POST { data_base64 } — max 8MB decoded. The vendored trustream.py is a
 * LIBRARY (encode_stream/decode_stream), so the driver is written inline
 * as `python3 -c`, loading the module via importlib from the TRUSTREAM_PY
 * path, reading raw bytes from stdin and writing packed bytes to stdout.
 */
export function validateTristreamPack(body) {
  if (!isPlainObject(body))
    return { ok: false, code: "bad_request", reason: "body must be an object" };
  const { data_base64 } = body;
  if (typeof data_base64 !== "string")
    return { ok: false, code: "bad_data_base64", reason: "data_base64 must be a string" };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data_base64) || data_base64.length % 4 !== 0)
    return { ok: false, code: "bad_data_base64", reason: "data_base64 is not valid base64" };
  const data = Buffer.from(data_base64, "base64");
  if (data.length > TRUSTREAM_MAX_BYTES)
    return { ok: false, code: "data_too_large", reason: `decoded data max ${TRUSTREAM_MAX_BYTES} bytes` };
  return { ok: true, value: { data } };
}

/** Integer per-mille size ratio (980 = packed is 98.0% of input). Floats
 *  are forbidden in receipt payloads, so the ratio stays an integer. */
export function packRatioMilli(bytesIn, bytesOut) {
  if (bytesIn === 0) return 0;
  return Math.round((bytesOut / bytesIn) * 1000);
}

export async function runTristreamPack(input, opts = {}) {
  const python = opts.pythonPath ?? "python3";
  const probe = spawnSync(python, ["--version"], { timeout: 10_000 });
  if (probe.error)
    throw new ToolRunError("trustream_unavailable", "python3 is not available", 500);
  const pyPath = opts.trustreamPyPath ?? process.env.TRUSTREAM_PY ?? "/app/vendor/trustream.py";
  try {
    accessSync(pyPath, fsConstants.R_OK);
  } catch {
    throw new ToolRunError("trustream_unavailable", "TRUSTREAM packer module not found", 500);
  }
  // argv after -c: ['-c', '--', '<pyPath>'] — path lands in sys.argv[2].
  const driver = [
    "import sys, importlib.util",
    "spec = importlib.util.spec_from_file_location('trustream_lib', sys.argv[2])",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "data = sys.stdin.buffer.read()",
    "sys.stdout.buffer.write(mod.encode_stream(data))",
  ].join("\n");
  const res = spawnSync(python, ["-c", driver, "--", pyPath], {
    input: input.data,
    timeout: opts.timeoutMs ?? TRUSTREAM_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    if (res.error.code === "ETIMEDOUT")
      throw new ToolRunError("trustream_timeout", "TRUSTREAM pack timed out", 503);
    throw res.error; // unexpected — route rethrows
  }
  if (res.status !== 0)
    throw new Error(
      `trustream driver failed (rc=${res.status}): ${String(res.stderr ?? "").slice(0, 500)}`
    );
  const packed = Buffer.from(res.stdout ?? Buffer.alloc(0));
  const bytes_in = input.data.length;
  const bytes_out = packed.length;
  return {
    result: "pass",
    packed, // route base64s this into the response body (never the receipt)
    detail: {
      bytes_in,
      bytes_out,
      ratio: packRatioMilli(bytes_in, bytes_out),
      tile_count: Math.ceil(bytes_in / TRUSTREAM_TILE),
    },
    input_hash: "sha256:" + sha256HexBytes(input.data),
  };
}

// ── 3. chamber-seal ─────────────────────────────────────────────────────

export const CHAMBER_SEAL_CUSTODY = "lab";

/**
 * POST { payload: object } — seals payload_hash (sha256 of the canonical
 * JSON of payload) in a Chamber envelope signed with CHAMBER_SIGNING_KEY
 * (ES256 P-256 PKCS8 PEM). Absent/empty key → 503 chamber_key_unavailable
 * (fail closed — EXPECTED in production until Corey installs the key as a
 * Fly secret; the tool exists and refuses, never fakes a seal).
 * NEVER reads ~/.config/slidphi-chamber; tests use ephemeral dev keys.
 */
export function validateChamberSeal(body) {
  if (!isPlainObject(body))
    return { ok: false, code: "bad_request", reason: "body must be an object" };
  if (!isPlainObject(body.payload))
    return { ok: false, code: "bad_payload", reason: "payload must be an object" };
  return { ok: true, value: { payload: body.payload } };
}

export async function runChamberSeal(input, opts = {}) {
  // NOTE: key material is only ever read from env/opts, never logged,
  // never written to disk, never read from ~/.config.
  const pem = (opts.chamberKeyPem ?? process.env.CHAMBER_SIGNING_KEY ?? "").trim();
  if (!pem)
    throw new ToolRunError(
      "chamber_key_unavailable",
      "CHAMBER_SIGNING_KEY is not installed — failing closed (no seal is minted without the lab's chamber key)",
      503
    );
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new ToolRunError(
      "chamber_key_unavailable",
      "CHAMBER_SIGNING_KEY is not a valid PEM key",
      503
    );
  }
  const payload_hash = sha256HexUtf8(canonicalJson(input.payload));
  // kid = RFC 7638 thumbprint of the CHAMBER public key (not the toll key).
  const spkiPem = createPublicKey(privateKey).export({ format: "pem", type: "spki" });
  const kid = tollSignerKid(spkiPem);
  const sealPayload = {
    type: "chamber-seal",
    version: 1,
    issuer: "slid-phi-labs",
    sealed_at: Math.floor(Date.now() / 1000),
    payload_hash,
    custody: CHAMBER_SEAL_CUSTODY,
  };
  let chamber_envelope;
  try {
    chamber_envelope = signTollPayload(sealPayload, { privateKey, kid });
  } catch (err) {
    throw new ToolRunError("chamber_seal_failed", `chamber seal failed: ${err.message}`, 500);
  }
  return {
    result: "pass",
    chamber_envelope,
    detail: { chamber_envelope, payload_hash },
    input_hash: "sha256:" + payload_hash,
  };
}

// ── 4. awlpay-quote ─────────────────────────────────────────────────────

export const AWL_RAILS = ["tron", "bitcoin", "lightning", "stellar", "bsc", "base"];
export const AWL_FEE_TIER = "free-0.5pct";
// Amounts that would overflow integer math are refused at validation.
export const AWL_MAX_AMOUNT_UUSDC = Math.floor((Number.MAX_SAFE_INTEGER - 999) / 5);

/**
 * fee_uusdc = ceil(amount * 0.5%) computed WITHOUT floats:
 *   floor((amount * 5 + 999) / 1000)
 * (0.5% = 5/1000; ceil(a/b) = floor((a + b - 1) / b) for integers.)
 */
export function awlpayFeeUusdc(amount_uusdc) {
  return Math.floor((amount_uusdc * 5 + 999) / 1000);
}

export function validateAwlpayQuote(body) {
  if (!isPlainObject(body))
    return { ok: false, code: "bad_request", reason: "body must be an object" };
  const { amount_uusdc, rail } = body;
  if (
    typeof amount_uusdc !== "number" ||
    !Number.isInteger(amount_uusdc) ||
    amount_uusdc < 1 ||
    amount_uusdc > AWL_MAX_AMOUNT_UUSDC
  )
    return { ok: false, code: "bad_amount", reason: "amount_uusdc must be an integer >= 1" };
  if (typeof rail !== "string" || !AWL_RAILS.includes(rail))
    return { ok: false, code: "bad_rail", reason: `rail must be one of: ${AWL_RAILS.join(",")}` };
  return { ok: true, value: { amount_uusdc, rail } };
}

/** Pure integer math, no dependencies — cannot fail closed. */
export function runAwlpayQuote(input) {
  const fee_uusdc = awlpayFeeUusdc(input.amount_uusdc);
  const net_uusdc = input.amount_uusdc - fee_uusdc;
  return {
    result: "pass",
    detail: {
      rail: input.rail,
      amount_uusdc: input.amount_uusdc,
      fee_uusdc,
      net_uusdc,
      fee_tier: AWL_FEE_TIER,
    },
    input_hash:
      "sha256:" +
      sha256HexUtf8(canonicalJson({ amount_uusdc: input.amount_uusdc, rail: input.rail })),
  };
}
