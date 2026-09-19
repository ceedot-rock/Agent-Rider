/**
 * Host-attestation scaffold honesty — no network, no secrets.
 * Asserts planned body shape and that the route stays a 501 stub.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "host-attestation.ts"), "utf8");

assert.match(src, /error:\s*"host_attestation_planned"/);
assert.match(src, /status:\s*"not_live"/);
assert.match(src, /PARKED until proven/);
assert.match(src, /HOST_ATTESTATION_LIVE/);
assert.match(src, /live:\s*false/);
assert.match(src, /fail closed|Fail-closed/i);
assert.match(src, /not live Nitro/i);
assert.doesNotMatch(src, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(src, /attestation is live/i);
assert.doesNotMatch(src, /Nitro live/i);

const route = readFileSync(join(__dirname, "../app/api/attestation/route.ts"), "utf8");
assert.match(route, /HOST_ATTESTATION_HTTP_STATUS|501/);
assert.match(route, /hostAttestationPlannedBody/);
assert.doesNotMatch(route, /\b(nsm|sev.?snp|getAttestationDoc)\b/i);

const doc = readFileSync(join(__dirname, "../../docs/HOST_ATTESTATION.md"), "utf8");
assert.match(doc, /PARKED until proven/);
assert.match(doc, /AWS Nitro Enclaves/);
assert.match(doc, /AMD SEV-SNP/);
assert.match(doc, /fail-closed|Fail-closed/i);
assert.match(doc, /OPERATOR_JOIN\.md/);
assert.match(doc, /AMP_MILESTONE\.md/);
assert.match(doc, /XPay/);
assert.match(doc, /never call PCC the money layer|PCC ≠ money layer/i);
assert.doesNotMatch(doc, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(doc, /attestation is live|Nitro is live|live on Fly.*Nitro/i);

console.log("host-attestation.selftest: ok (parked not live)");
