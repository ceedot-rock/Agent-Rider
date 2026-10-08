/**
 * Toll Tools — Wave 1 core logic (node builtins only, no side effects
 * beyond running the local PCC binary as a child process).
 *
 * Validators return {ok:true, value, detail?} | {ok:false, code, reason}.
 * The SAME validator functions serve both the sandbox branch
 * (sandboxTool, via toll-sandbox.ts) and the live route, so sandbox and
 * live agree on input shape.
 *
 * Runners throw:
 *   - ToolInputError-like {name:"ToolInputError", code} → route maps to 400
 *     (runners re-validate defensively, but the route validates first).
 *   - {name:"ToolDependencyError", code, status} → route maps to status.
 *   - anything else → route lets it throw (fail closed, no receipt).
 *
 * Run tests: cd src && node lib/toll-tools-wave1.selftest.mjs
 */

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNotarizationPayload,
  buildExactnessAttestation,
} from "./toll-public-core.mjs";

// ── limits ──────────────────────────────────────────────────────────────
// Measured 2026-10-08 on this repo's bundled savant_codec2 (full
// `encode_whole` bake-off, adversarial random input, local VM):
//   100 KB input → ~3.0 s median encode, codec declines (no output file)
//   1 MB input  → ~48 s median encode (42.9 / 49.0 / 53.0 s), declines
//   4 MB input  → ~364 s single run, declines
// Decode is cheap (~13 ms for 46 KB, byte-identical roundtrip verified).
// The bake-off does the same work on compressible data; random input is
// near-worst-case because every arm runs to completion and fails.
// Cap 4MB decoded + a hard 90s kill gives bounded worst-case latency per
// request. Consequence, stated plainly: adversarial inputs above ~1.5MB
// will exceed the 90s kill and fail closed (500, no receipt) rather than
// hang the request — the correct posture for a metered endpoint. If
// production p99 shows timeouts on legitimate inputs, lower the cap to
// 1MB (measured worst 53s < 90s there).

export const PCC_MAX_DECODED_BYTES = 4 * 1024 * 1024; // 4 MB
export const PCC_ENCODE_TIMEOUT_MS = 90_000; // 90 s hard kill
export const PCC_DECODE_TIMEOUT_MS = 60_000; // 60 s hard kill
export const PCC_MAX_BLOB_BYTES = 8 * 1024 * 1024; // verify blob cap
export const ATTEST_MAX_BODY_BYTES = 64 * 1024; // mirrors public attest

// ── error shapes (mirror toll-tools.ts error names; .mjs keeps them
// dependency-free so the selftest runs with plain node) ────────────────

export class ToolInputError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
  }
}

export class ToolDependencyError extends Error {
  code;
  status;
  constructor(code, message, status = 500) {
    super(message);
    this.name = "ToolDependencyError";
    this.code = code;
    this.status = status;
  }
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBase64(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  // Length multiple of 4 (allow unpadded too), base64 alphabet only.
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.replace(/=/g, "").length > 0;
}

function isHex64(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);
}

/** Canonical input bytes for the input_hash on receipts. */
export function canonicalInputBytes(marker, value) {
  return Buffer.from(`${marker}:${value}`, "utf8");
}

// ── binary helpers ──────────────────────────────────────────────────────

function pccBinary() {
  // Same override as toll-tools.ts pccBin(), duplicated here so this
  // module stays dependency-free.
  return process.env.PCC_BIN ?? "/app/pcc-bin/savant_codec2";
}

function runWithTimeout(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new ToolDependencyError("pcc_timeout", `codec exceeded ${timeoutMs}ms`, 500));
          return;
        }
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        reject(new ToolDependencyError("pcc_binary_missing", `PCC binary not found at ${file}`, 503));
      } else {
        reject(err);
      }
    });
  });
}

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "tolltool-"));
  try {
    // MUST await: without it, the finally below deletes the temp dir
    // while the codec child is still running (race → missing output).
    return await fn(dir);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

// ── pcc-compress ────────────────────────────────────────────────────────

/**
 * POST {data_base64} — up to PCC_MAX_DECODED_BYTES decoded bytes.
 * detail on success includes the decoded byte count and the sha256 of the
 * canonical base64 input (not the raw bytes — base64 text is the
 * request-level input).
 */
export function validatePccCompress(body) {
  if (!isPlainObject(body)) return { ok: false, code: "malformed_request", reason: "body must be a JSON object" };
  const { data_base64 } = body;
  if (!isBase64(data_base64))
    return { ok: false, code: "bad_data_base64", reason: "data_base64 must be a non-empty base64 string" };
  let decoded;
  try {
    decoded = Buffer.from(data_base64, "base64");
  } catch {
    return { ok: false, code: "bad_data_base64", reason: "data_base64 is not decodable base64" };
  }
  if (decoded.length === 0)
    return { ok: false, code: "empty_input", reason: "decoded input is empty" };
  if (decoded.length > PCC_MAX_DECODED_BYTES)
    return {
      ok: false,
      code: "input_too_large",
      reason: `decoded input ${decoded.length} bytes exceeds cap ${PCC_MAX_DECODED_BYTES}`,
    };
  return {
    ok: true,
    value: { data_base64, decoded },
    detail: { bytes_in: decoded.length },
  };
}

export async function runPccCompress({ data_base64, decoded }) {
  const bytes_in = decoded.length;
  const sha256_in = sha256Hex(decoded);
  const result = await withTempDir(async (dir) => {
    const inPath = join(dir, "in.bin");
    const outPath = join(dir, "out.pcc");
    writeFileSync(inPath, decoded);
    await runWithTimeout(pccBinary(), ["encode_whole", inPath, outPath], PCC_ENCODE_TIMEOUT_MS);
    let outBuf;
    try {
      outBuf = readFileSync(outPath);
    } catch {
      // Codec ran but produced no output file → it declined the input
      // (incompressible / refused). Negative outcome, still receipted.
      return {
        result: "refuse",
        detail: {
          bytes_in,
          bytes_out: null,
          ratio: null,
          sha256_in,
          sha256_out: null,
          refusal: "codec_declined",
          refusal_detail: "savant_codec2 encode_whole produced no output file (input declined or incompressible)",
        },
      };
    }
    if (outBuf.length === 0)
      return {
        result: "refuse",
        detail: {
          bytes_in,
          bytes_out: 0,
          ratio: null,
          sha256_in,
          sha256_out: null,
          refusal: "codec_empty_output",
          refusal_detail: "savant_codec2 encode_whole produced an empty output file",
        },
      };
    return {
      result: "pass",
      detail: {
        bytes_in,
        bytes_out: outBuf.length,
        // Integer per-mille (750 = output is 75.0% of input). Floats are
        // forbidden in receipt payloads (canonicalJson refuses them).
        ratio: Math.round((outBuf.length * 1000) / bytes_in),
        sha256_in,
        sha256_out: sha256Hex(outBuf),
      },
    };
  });
  return result;
}

// ── pcc-verify ──────────────────────────────────────────────────────────

/**
 * POST {blob_base64, orig_size (int ≥1), expected_sha256 (hex)}.
 * Decodes the blob, SHA-256s it, compares to expected_sha256.
 */
export function validatePccVerify(body) {
  if (!isPlainObject(body)) return { ok: false, code: "malformed_request", reason: "body must be a JSON object" };
  const { blob_base64, orig_size, expected_sha256 } = body;
  if (!isBase64(blob_base64))
    return { ok: false, code: "bad_blob_base64", reason: "blob_base64 must be a non-empty base64 string" };
  let decoded;
  try {
    decoded = Buffer.from(blob_base64, "base64");
  } catch {
    return { ok: false, code: "bad_blob_base64", reason: "blob_base64 is not decodable base64" };
  }
  if (decoded.length === 0 || decoded.length > PCC_MAX_BLOB_BYTES)
    return {
      ok: false,
      code: "blob_size_out_of_range",
      reason: `decoded blob must be 1..${PCC_MAX_BLOB_BYTES} bytes`,
    };
  if (!Number.isInteger(orig_size) || orig_size < 1)
    return { ok: false, code: "bad_orig_size", reason: "orig_size must be an integer ≥ 1" };
  if (!isHex64(expected_sha256))
    return { ok: false, code: "bad_expected_sha256", reason: "expected_sha256 must be 64 hex chars" };
  return {
    ok: true,
    value: { decoded, orig_size, expected_sha256: expected_sha256.toLowerCase() },
    detail: { blob_bytes: decoded.length, orig_size },
  };
}

export async function runPccVerify({ decoded, orig_size, expected_sha256 }) {
  const result = await withTempDir(async (dir) => {
    const inPath = join(dir, "blob.pcc");
    const outPath = join(dir, "out.bin");
    writeFileSync(inPath, decoded);
    await runWithTimeout(pccBinary(), ["decode", inPath, String(orig_size), outPath], PCC_DECODE_TIMEOUT_MS);
    let outBuf;
    try {
      outBuf = readFileSync(outPath);
    } catch {
      throw new ToolDependencyError("pcc_decode_failed", "codec decode produced no output file", 500);
    }
    const actual = sha256Hex(outBuf);
    if (actual !== expected_sha256) {
      return {
        result: "refuse",
        detail: {
          blob_bytes: decoded.length,
          orig_size,
          bytes_out: outBuf.length,
          expected_sha256,
          actual_sha256: actual,
          refusal: "sha256_mismatch",
          refusal_detail: "decoded output SHA-256 does not match expected_sha256",
        },
      };
    }
    return {
      result: "pass",
      detail: {
        blob_bytes: decoded.length,
        orig_size,
        bytes_out: outBuf.length,
        sha256: actual,
      },
    };
  });
  return result;
}

// ── attest-notarize ─────────────────────────────────────────────────────

/**
 * POST {payload: object} — metered twin of the free public notarization.
 * Validates the payload is a non-null non-array object, then delegates to
 * the shared buildNotarizationPayload from toll-public-core.mjs.
 */
export function validateAttestNotarize(body) {
  if (!isPlainObject(body)) return { ok: false, code: "malformed_request", reason: "body must be a JSON object" };
  const { payload } = body;
  if (!isPlainObject(payload))
    return { ok: false, code: "bad_payload", reason: "payload must be a non-null object (no arrays)" };
  const rawBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (rawBytes > ATTEST_MAX_BODY_BYTES)
    return {
      ok: false,
      code: "body_too_large",
      reason: `body ${rawBytes} bytes exceeds cap ${ATTEST_MAX_BODY_BYTES}`,
    };
  return { ok: true, value: { payload }, detail: { keys: Object.keys(payload).length } };
}

export function runAttestNotarize({ payload }) {
  const now = Math.floor(Date.now() / 1000);
  // buildNotarizationPayload throws TollReceiptError on floats — surfaced
  // as ToolInputError 400 "floats_refused" (same contract as public attest).
  let attPayload;
  try {
    attPayload = buildNotarizationPayload({ payload, attested_at: now });
  } catch (err) {
    throw new ToolInputError("floats_refused", err?.message ?? "payload contains floats");
  }
  return {
    result: "pass",
    detail: {
      payload_hash: attPayload.payload_hash,
      attested_at: now,
      mode: "notarization",
    },
  };
}

// ── attest-exactness ────────────────────────────────────────────────────

/**
 * POST {artifact: object, claim: object} — runs the v5 exactness pipeline
 * via buildExactnessAttestation. OracleError → 400 malformed_check_request
 * (the route maps OracleError; this function lets it propagate as-is).
 */
export function validateAttestExactness(body) {
  if (!isPlainObject(body)) return { ok: false, code: "malformed_request", reason: "body must be a JSON object" };
  const { artifact, claim } = body;
  if (!isPlainObject(artifact))
    return { ok: false, code: "bad_artifact", reason: "artifact must be a non-null object (no arrays)" };
  if (!isPlainObject(claim))
    return { ok: false, code: "bad_claim", reason: "claim must be a non-null object (no arrays)" };
  const rawBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (rawBytes > ATTEST_MAX_BODY_BYTES)
    return {
      ok: false,
      code: "body_too_large",
      reason: `body ${rawBytes} bytes exceeds cap ${ATTEST_MAX_BODY_BYTES}`,
    };
  return { ok: true, value: { artifact, claim } };
}

export function runAttestExactness({ artifact, claim }) {
  const now = Math.floor(Date.now() / 1000);
  // OracleError propagates to the route → 400 malformed_check_request.
  const att = buildExactnessAttestation({ artifact, claim, checked_at: now });
  return {
    result: att.result,
    detail: {
      result: att.result,
      artifact_hash: att.payload.artifact_hash,
      checked_at: now,
      ...att.detail,
    },
  };
}

/** Random receipt id — same shape as the v5 route's receipt ids. */
export function newReceiptId() {
  return `tool_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
