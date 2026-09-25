/**
 * CuNi citizen-receipt HTTP receive — auth + bind + honesty selftest.
 * No network, no secrets, no Stripe/Supabase.
 * Run: cd src && npm run selftest:cuni-citizen-receipt-http
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- mirror validate / extract (same rules as cuni-citizen-gate) ---
function extractCitizenReceiptCandidate(body) {
  if (!body || typeof body !== "object") return undefined;
  const obj = body;
  for (const key of ["citizen_receipt", "citizenReceipt", "receipt"]) {
    if (obj[key] != null && typeof obj[key] === "object") return obj[key];
  }
  const meta = obj.meta && typeof obj.meta === "object" ? obj.meta : null;
  const hints = (o) =>
    typeof o.source_hash === "string" ||
    typeof o.sourceHash === "string" ||
    (o.exactness != null && typeof o.exactness === "object");
  if (meta && hints(meta)) return meta;
  if (hints(obj)) return obj;
  return undefined;
}

function validateCitizenReceiptShape(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return { ok: false, missing: ["source_hash", "exactness.passed"] };
  }
  const missing = [];
  const hashRaw =
    typeof receipt.source_hash === "string"
      ? receipt.source_hash
      : typeof receipt.sourceHash === "string"
        ? receipt.sourceHash
        : null;
  const source_hash = hashRaw && hashRaw.trim().length > 0 ? hashRaw.trim() : null;
  if (!source_hash) missing.push("source_hash");
  const exact =
    receipt.exactness && typeof receipt.exactness === "object" ? receipt.exactness : null;
  if (!exact || exact.passed !== true) missing.push("exactness.passed");
  if (missing.length) return { ok: false, missing };
  return { ok: true, receipt: { source_hash, exactness: { passed: true } } };
}

/** Strict gate used by ingest (receipt always required). */
function ingestCheck(body) {
  const candidate = extractCitizenReceiptCandidate(body);
  if (candidate === undefined) {
    return { ok: false, error: "citizen_receipt_required" };
  }
  const v = validateCitizenReceiptShape(candidate);
  if (!v.ok) return { ok: false, error: "citizen_receipt_invalid", missing: v.missing };
  return { ok: true, receipt: v.receipt };
}

function checkIngestAuth({
  configuredKey,
  bearer,
  ingestKeyHeader,
  merchantOk,
  apiKeyResolved,
  open,
}) {
  if (configuredKey) {
    if (bearer === configuredKey || ingestKeyHeader === configuredKey) {
      return { ok: true, mode: "ingest_key" };
    }
    if (merchantOk) return { ok: true, mode: "merchant" };
    if (apiKeyResolved) return { ok: true, mode: "api_key" };
    return { ok: false, status: 401, error: "unauthorized_ingest" };
  }
  if (merchantOk) return { ok: true, mode: "merchant" };
  if (apiKeyResolved) return { ok: true, mode: "api_key" };
  if (open) return { ok: true, mode: "open" };
  return { ok: false, status: 401, error: "unauthorized_ingest" };
}

// In-memory bind mirror
const memory = new Map();
function bindReceipt(receipt, bind = {}) {
  const v = validateCitizenReceiptShape(receipt);
  if (!v.ok) return { ok: false, error: "citizen_receipt_invalid", missing: v.missing };
  const existing = memory.get(v.receipt.source_hash);
  if (existing) {
    const merged = { ...existing, bind: { ...existing.bind, ...bind } };
    memory.set(v.receipt.source_hash, merged);
    return { ok: true, record: merged, idempotent: true };
  }
  const record = {
    id: `cr_test_${memory.size + 1}`,
    source_hash: v.receipt.source_hash,
    exactness: v.receipt.exactness,
    bind,
    ingress: "studio_http",
  };
  memory.set(v.receipt.source_hash, record);
  return { ok: true, record, idempotent: false };
}

// --- accept PASS ---
const passBody = {
  citizen_receipt: { source_hash: "abc123", exactness: { passed: true } },
  bind: { agent_id: "agent-1", job_id: "job-9" },
};
assert.equal(ingestCheck(passBody).ok, true);
assert.equal(ingestCheck(passBody).receipt.source_hash, "abc123");
const bound = bindReceipt(passBody.citizen_receipt, passBody.bind);
assert.equal(bound.ok, true);
assert.equal(bound.idempotent, false);
assert.equal(bound.record.bind.agent_id, "agent-1");
const again = bindReceipt(passBody.citizen_receipt, { contract_id: "ctr_1" });
assert.equal(again.ok, true);
assert.equal(again.idempotent, true);
assert.equal(again.record.bind.agent_id, "agent-1");
assert.equal(again.record.bind.contract_id, "ctr_1");

// alias sourceHash
assert.equal(
  ingestCheck({
    citizenReceipt: { sourceHash: "deadbeef", exactness: { passed: true } },
  }).ok,
  true
);

// --- reject fail ---
assert.equal(
  ingestCheck({
    citizen_receipt: { source_hash: "abc", exactness: { passed: false } },
  }).error,
  "citizen_receipt_invalid"
);
assert.equal(
  ingestCheck({
    citizen_receipt: { exactness: { passed: true } },
  }).error,
  "citizen_receipt_invalid"
);
assert.equal(
  bindReceipt({ source_hash: "x", exactness: { passed: false } }).ok,
  false
);

// --- missing under strict (ingest always strict) ---
assert.equal(ingestCheck({ hop_id: "h1" }).error, "citizen_receipt_required");
assert.equal(ingestCheck({}).error, "citizen_receipt_required");
assert.equal(ingestCheck(null).error, "citizen_receipt_required");

// --- auth ---
assert.equal(
  checkIngestAuth({
    configuredKey: "secret-ingest",
    bearer: "secret-ingest",
  }).mode,
  "ingest_key"
);
assert.equal(
  checkIngestAuth({
    configuredKey: "secret-ingest",
    ingestKeyHeader: "secret-ingest",
  }).mode,
  "ingest_key"
);
assert.equal(
  checkIngestAuth({
    configuredKey: "secret-ingest",
    bearer: "wrong",
  }).error,
  "unauthorized_ingest"
);
assert.equal(
  checkIngestAuth({
    configuredKey: "secret-ingest",
    bearer: "wrong",
    merchantOk: true,
  }).mode,
  "merchant"
);
assert.equal(
  checkIngestAuth({
    configuredKey: null,
    open: false,
  }).error,
  "unauthorized_ingest"
);
assert.equal(
  checkIngestAuth({
    configuredKey: null,
    open: true,
  }).mode,
  "open"
);
assert.equal(
  checkIngestAuth({
    configuredKey: null,
    apiKeyResolved: true,
  }).mode,
  "api_key"
);

// --- source honesty ---
const storeSrc = readFileSync(join(__dirname, "cuni-citizen-receipt-store.ts"), "utf8");
assert.match(storeSrc, /CUNI_STUDIO_INGEST_KEY/);
assert.match(storeSrc, /CUNI_CITIZEN_RECEIPT_INGEST_OPEN/);
assert.match(storeSrc, /Does NOT call CuNi Studio|does NOT call Studio|does not call Studio/i);
assert.match(storeSrc, /XPay|never PCC/i);
assert.doesNotMatch(storeSrc, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(storeSrc, /Studio is live|live Studio citizen gate is on/i);

const routeSrc = readFileSync(
  join(__dirname, "../app/api/v0/citizen-receipts/route.ts"),
  "utf8"
);
assert.match(routeSrc, /POST \/api\/v0\/citizen-receipts/);
assert.match(routeSrc, /X-Cuni-Ingest-Key|CUNI_STUDIO_INGEST_KEY/);
assert.match(routeSrc, /studio_roundtrip:\s*"not_applicable"/);
assert.match(routeSrc, /does not call CuNi Studio/i);
assert.doesNotMatch(routeSrc, /\bar_[A-Za-z0-9]{8,}/);

const contractsSrc = readFileSync(
  join(__dirname, "../app/api/v0/contracts/route.ts"),
  "utf8"
);
assert.match(contractsSrc, /bindCitizenReceipt/);
assert.match(contractsSrc, /citizen_receipt_bound/);

const doc = readFileSync(join(__dirname, "../../docs/CUNI_CITIZEN_GATE.md"), "utf8");
assert.match(doc, /\/api\/v0\/citizen-receipts/);
assert.match(doc, /CUNI_STUDIO_INGEST_KEY/);
assert.match(doc, /CUNI_CITIZEN_RECEIPT_REQUIRED/);
assert.match(doc, /never PCC|not PCC/i);
assert.match(doc, /receive|RECEIVE|HTTP receive/i);
assert.match(doc, /WIRED|env-gated|CUNI_STUDIO_PASS_REQUIRED/i);
assert.doesNotMatch(doc, /\bar_[A-Za-z0-9]{8,}/);
// Must not claim soft always-live outbound
assert.doesNotMatch(doc, /always live Studio|always calls Studio/i);
assert.doesNotMatch(doc, /outbound still \*\*PARKED\*\*/i);

const coord = readFileSync(join(__dirname, "../../docs/_CUNI_COORD_PASS_GATE.md"), "utf8");
assert.match(coord, /\/api\/v0\/citizen-receipts/);
assert.match(coord, /citizen_receipt/);
assert.match(coord, /exactness\.passed/);
assert.doesNotMatch(coord, /\bar_[A-Za-z0-9]{8,}/);

const status = readFileSync(join(__dirname, "../../docs/_STATUS_CUNI_RECEIPT.md"), "utf8");
assert.match(status, /feat\/cuni-citizen-receipt-http|citizen-receipt/);
assert.match(status, /selftest/);

console.log(
  "cuni-citizen-receipt-http.selftest: ok (accept PASS / reject fail / missing strict / auth / honesty)"
);
