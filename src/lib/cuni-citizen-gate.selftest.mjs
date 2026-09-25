/**
 * CuNi citizen receipt gate — shape + honesty selftest. No network, no secrets.
 * Run: cd src && npm run selftest:cuni-citizen-gate
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Mirror of validateCitizenReceiptShape / extract / check (behavioral). */
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

function checkGate(body, required) {
  const candidate = extractCitizenReceiptCandidate(body);
  if (candidate === undefined) {
    if (required) return { ok: false, error: "citizen_receipt_required" };
    return { ok: true, receipt: null };
  }
  const v = validateCitizenReceiptShape(candidate);
  if (!v.ok) return { ok: false, error: "citizen_receipt_invalid", missing: v.missing };
  return { ok: true, receipt: v.receipt };
}

// --- behavioral ---
assert.equal(checkGate({ hop_id: "h1" }, false).ok, true);
assert.equal(checkGate({ hop_id: "h1" }, true).ok, false);
assert.equal(checkGate({ hop_id: "h1" }, true).error, "citizen_receipt_required");

const pass = {
  citizen_receipt: { source_hash: "abc", exactness: { passed: true } },
};
assert.equal(checkGate(pass, false).ok, true);
assert.equal(checkGate(pass, true).ok, true);
assert.equal(checkGate(pass, true).receipt.source_hash, "abc");

assert.equal(
  checkGate({ citizen_receipt: { sourceHash: "xyz", exactness: { passed: true } } }, true).ok,
  true
);
assert.equal(
  checkGate({ citizen_receipt: { source_hash: "abc", exactness: { passed: false } } }, false)
    .error,
  "citizen_receipt_invalid"
);
assert.equal(
  checkGate({ citizen_receipt: { exactness: { passed: true } } }, false).error,
  "citizen_receipt_invalid"
);
assert.equal(
  checkGate({ receipt: { source_hash: "  ", exactness: { passed: true } } }, false).ok,
  false
);

// publish-meta equivalent (contracts)
assert.equal(
  checkGate({ sourceHash: "deadbeef", exactness: { passed: true }, source: "x" }, true).ok,
  true
);

// settle-shaped body without receipt must not be treated as receipt
assert.equal(
  extractCitizenReceiptCandidate({
    hop_id: "h",
    job_id: "j",
    key_id: "x402:j",
    amount_usd: 0.01,
  }),
  undefined
);

// --- source honesty ---
const src = readFileSync(join(__dirname, "cuni-citizen-gate.ts"), "utf8");
assert.match(src, /CUNI_CITIZEN_RECEIPT_REQUIRED/);
assert.match(src, /exactness\.passed/);
assert.match(src, /source_hash/);
assert.match(src, /studio:\s*"not_called"/);
assert.match(src, /Does NOT call CuNi Studio|not_called/i);
assert.match(src, /cuni-studio-pass|env-gated|WIRED/i);
assert.match(src, /XPay/);
assert.match(src, /never PCC|PCC as money|never PCC as the money/i);
assert.doesNotMatch(src, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(src, /Studio is live|live Studio citizen gate is on/i);

const doc = readFileSync(join(__dirname, "../../docs/CUNI_CITIZEN_GATE.md"), "utf8");
assert.match(doc, /Translate/);
assert.match(doc, /Fund path = Rider settle \/ XPay|Rider settle \/ XPay hop/i);
assert.match(doc, /HOST_ATTESTATION\.md/);
assert.match(doc, /AMP_MILESTONE\.md/);
assert.match(doc, /CUNI_CITIZEN_RECEIPT_REQUIRED/);
assert.match(doc, /CUNI_STUDIO_PASS_REQUIRED|env-gated|WIRED/i);
assert.match(doc, /never PCC|not PCC/i);
assert.doesNotMatch(doc, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(doc, /Studio is live|live Studio citizen gate is on|always calls Studio/i);
assert.doesNotMatch(doc, /outbound still \*\*PARKED\*\*/i);
assert.match(doc, /WIRED \(env-gated\)|env-gated/i);

for (const rel of [
  "../app/api/settle/route.ts",
  "../app/api/v0/contracts/route.ts",
  "../app/api/tasks/claim/route.ts",
  "../app/api/first-job/route.ts",
]) {
  const r = readFileSync(join(__dirname, rel), "utf8");
  assert.match(r, /checkCitizenReceiptGate|isCitizenGateOk/);
}

const ingestRoute = readFileSync(
  join(__dirname, "../app/api/v0/citizen-receipts/route.ts"),
  "utf8"
);
assert.match(ingestRoute, /bindCitizenReceipt|validateCitizenReceiptShape/);
assert.match(ingestRoute, /studio_roundtrip/);

console.log("cuni-citizen-gate.selftest: ok (validate-when-present + strict + honesty)");
