/**
 * Attestation evidence shape + fail-closed gate — offline selftest.
 * Does NOT claim Nitro/SEV verify. /api/attestation must stay 501 parked.
 * Run: cd src && node lib/attestation-evidence.selftest.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAttestationRequired,
  validateAttestationEvidenceShape,
  assertAttestationForSensitiveOp,
  attestationRefuseBody,
  ATTESTATION_REQUIRED_HTTP_STATUS,
  ATTESTATION_PLATFORMS,
} from "./attestation-evidence.mjs";
import {
  serializeSealedRideEnvelope,
  isForbiddenEnvelopeFieldName,
  redactForLog,
} from "./sealed-ride-envelope.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

assert.equal(isAttestationRequired({}), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "" }), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "false" }), false);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "1" }), true);
assert.equal(isAttestationRequired({ ATTESTATION_REQUIRED: "true" }), true);
assert.ok(ATTESTATION_PLATFORMS.includes("none"));

assert.equal(validateAttestationEvidenceShape(null).ok, false);

const shapeOk = validateAttestationEvidenceShape({
  platform: "none",
  measurement: null,
  nonce: null,
  issued_at: null,
  evidence: null,
  verify: { required: false, result: "skipped_not_live" },
});
assert.equal(shapeOk.ok, true, shapeOk.detail || "shape");

const off = assertAttestationForSensitiveOp(undefined, {});
assert.equal(off.ok, true, "default off must allow");

const requiredMissing = assertAttestationForSensitiveOp(undefined, {
  ATTESTATION_REQUIRED: "true",
});
assert.equal(requiredMissing.ok, false);
assert.equal(requiredMissing.status, ATTESTATION_REQUIRED_HTTP_STATUS);

const requiredShapeOkStillRefuse = assertAttestationForSensitiveOp(shapeOk.evidence, {
  ATTESTATION_REQUIRED: "true",
});
assert.equal(requiredShapeOkStillRefuse.ok, false);
assert.equal(
  requiredShapeOkStillRefuse.body.error,
  "attestation_verify_not_implemented"
);

const refuse = attestationRefuseBody("attestation_evidence_missing");
assert.equal(refuse.live, false);
assert.match(refuse.message, /PARKED|fail-closed|ATTESTATION_REQUIRED/i);

assert.equal(isForbiddenEnvelopeFieldName("ar_secret"), true);
assert.equal(isForbiddenEnvelopeFieldName("agent_id"), false);
assert.throws(() =>
  serializeSealedRideEnvelope({ agent_id: "a1", ar_api_key: "ar_nope" })
);
const json = serializeSealedRideEnvelope({
  agent_id: "a1",
  level: "L1",
  attestation: { platform: "none", evidence: null },
});
assert.equal(JSON.parse(json).agent_id, "a1");
assert.equal(redactForLog({ ar_token: "ar_abc12345zzzz" }).ar_token, "[REDACTED]");

const route = readFileSync(join(__dirname, "../app/api/attestation/route.ts"), "utf8");
assert.match(route, /hostAttestationPlannedBody/);
assert.match(route, /HOST_ATTESTATION_HTTP_STATUS/);
assert.doesNotMatch(route, /assertAttestationForSensitiveOp|validateAttestationEvidenceShape/);

const host = readFileSync(join(__dirname, "host-attestation.ts"), "utf8");
assert.match(host, /host_attestation_planned/);
assert.match(host, /not_live/);

console.log("attestation-evidence.selftest: ok (shape + fail-closed + route stays parked)");
