/**
 * Attestation evidence schema + ATTESTATION_REQUIRED fail-closed selftest.
 * No network, no secrets. Run: cd src && npm run selftest:attestation-evidence
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAttestationRequired,
  validateAttestationEvidenceShape,
  assertAttestationForSensitiveOp,
  collectAttestationEvidenceStub,
  readAttestationEvidence,
} from "./attestation-evidence.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- flag parsing ---
assert.equal(isAttestationRequired({}), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "" }), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "0" }), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "1" }), true);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "true" }), true);
assert.equal(isAttestationRequired({ HOST_ATTESTATION: "1" }), true);
assert.equal(isAttestationRequired({ HOST_ATTESTATION_REQUIRED: "yes" }), true);

// --- shape: good parked stub ---
const good = collectAttestationEvidenceStub({ nonce: "n1" });
const shapeOk = validateAttestationEvidenceShape(good);
assert.equal(shapeOk.ok, true);
assert.equal(good.platform, "none");
assert.equal(good.status, "not_live");
assert.equal(good.verify.result, "skipped_not_live");

// --- shape: missing / bad ---
assert.equal(validateAttestationEvidenceShape(null).ok, false);
assert.equal(validateAttestationEvidenceShape({ platform: "nitro" }).ok, false);
assert.equal(
  validateAttestationEvidenceShape({
    platform: "bogus",
    measurement: null,
    nonce: null,
    issued_at: null,
    evidence: null,
  }).ok,
  false
);
assert.equal(
  validateAttestationEvidenceShape({
    platform: "none",
    measurement: null,
    nonce: null,
    issued_at: null,
    evidence: null,
    api_key: "nope",
  }).ok,
  false
);
assert.equal(
  validateAttestationEvidenceShape({
    platform: "none",
    measurement: null,
    nonce: null,
    issued_at: null,
    evidence: null,
    ar_secret: "x",
  }).ok,
  false
);

// --- gate: off-by-default = pass-through ---
assert.equal(assertAttestationForSensitiveOp(undefined, {}).ok, true);
assert.equal(assertAttestationForSensitiveOp(null, { ATTESTATION_REQUIRED: "false" }).ok, true);
assert.equal(assertAttestationForSensitiveOp({ bogus: true }, {}).ok, true);

// --- gate: on + missing = reject ---
{
  const r = assertAttestationForSensitiveOp(undefined, { ATTESTATION_REQUIRED: "1" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "attestation_evidence_required");
  assert.equal(r.body.live, false);
}

// --- gate: on + bad = reject ---
{
  const r = assertAttestationForSensitiveOp(
    { platform: "none" },
    { ATTESTATION_REQUIRED: "true" }
  );
  assert.equal(r.ok, false);
  assert.equal(r.body.error, "attestation_evidence_malformed");
}

// --- gate: on + good shape = still refuse (verify not implemented — fail-closed) ---
{
  const r = assertAttestationForSensitiveOp(good, { ATTESTATION_REQUIRED: "1" });
  assert.equal(r.ok, false);
  assert.equal(r.body.error, "attestation_verify_not_implemented");
  assert.equal(r.body.shape_ok, true);
  assert.equal(r.body.nitro_verify, false);
  assert.equal(r.body.live, false);
}

// --- read helpers ---
assert.equal(readAttestationEvidence({}), undefined);
assert.deepEqual(
  readAttestationEvidence({ body: { attestation_evidence: good } }),
  good
);
const malformed = readAttestationEvidence({ headerJson: "{not-json" });
assert.equal(malformed.__malformed_header, true);

// --- honesty: no live Nitro claims / no ar_ secrets in sources ---
const src = readFileSync(join(__dirname, "attestation-evidence.mjs"), "utf8");
assert.match(src, /ATTESTATION_REQUIRED/);
assert.match(src, /fail-closed|Fail-closed/i);
assert.match(src, /PARKED|not live/i);
assert.match(src, /attestation_verify_not_implemented/);
assert.doesNotMatch(src, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(src, /Nitro is live|attestation is live on Fly/i);

const route = readFileSync(join(__dirname, "../app/api/attestation/route.ts"), "utf8");
assert.match(route, /501|HOST_ATTESTATION_HTTP_STATUS/);
assert.match(route, /hostAttestationPlannedBody/);
assert.doesNotMatch(route, /\b(nsm|getAttestationDoc)\b/i);

console.log(
  "attestation-evidence.selftest: ok (off pass-through; on miss/bad/shape refuse; 501 stub honesty)"
);
