/**
 * Toll 1 + Toll 2 — flag-off honesty, capability schema, L0 excluded from verified lookup.
 * No network, no secrets. Run: cd src && npm run selftest:toll-1-2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCapabilityUpsert,
  filterAndRankCapabilities,
  honestyForLevel,
  isToll1MeterLive,
  isToll2LookupLive,
  isToll2PromoteLive,
  isVerifiedEvidenceLevel,
} from "./capabilities-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

// ── Flags default OFF ──────────────────────────────────────────────────────
assert.equal(isToll1MeterLive({}), false);
assert.equal(isToll1MeterLive({ TOLL1_METER_LIVE: "" }), false);
assert.equal(isToll1MeterLive({ TOLL1_METER_LIVE: "0" }), false);
assert.equal(isToll1MeterLive({ TOLL1_METER_LIVE: "1" }), true);
assert.equal(isToll1MeterLive({ TOLL1_METER_LIVE: "true" }), true);
assert.equal(isToll2LookupLive({ TOLL2_LOOKUP_LIVE: "1" }), true);
assert.equal(isToll2LookupLive({}), false);
assert.equal(isToll2PromoteLive({}), false);
assert.equal(isToll2PromoteLive({ TOLL2_PROMOTE_LIVE: "true" }), true);

// ── Route sources: 503 + error codes when flag off ─────────────────────────
const toll1 = readFileSync(join(__dirname, "../app/api/toll/v1/verify/route.ts"), "utf8");
assert.match(toll1, /isToll1MeterLive/);
assert.match(toll1, /toll1_meter_off|TOLL1_OFF_BODY/);
assert.match(toll1, /status:\s*503/);
assert.match(toll1, /verifyRider/);
assert.match(toll1, /reportRiderVerifyOverage/);
assert.doesNotMatch(toll1, /fork.*x402|second.?[Ww]arrant/);

const toll2lookup = readFileSync(join(__dirname, "../app/api/toll/v2/lookup/route.ts"), "utf8");
assert.match(toll2lookup, /isToll2LookupLive/);
assert.match(toll2lookup, /toll2_lookup_off|TOLL2_LOOKUP_OFF_BODY/);
assert.match(toll2lookup, /status:\s*503/);
assert.match(toll2lookup, /verified_only:\s*true/);

const toll2promote = readFileSync(join(__dirname, "../app/api/toll/v2/promote/route.ts"), "utf8");
assert.match(toll2promote, /isToll2PromoteLive/);
assert.match(toll2promote, /toll2_promote_off|TOLL2_PROMOTE_OFF_BODY/);
assert.match(toll2promote, /status:\s*503/);

const freeUpsert = readFileSync(join(__dirname, "../app/api/capabilities/route.ts"), "utf8");
assert.match(freeUpsert, /self_only/);
assert.match(freeUpsert, /free:\s*true/);

const freeGet = readFileSync(join(__dirname, "../app/api/capabilities/[id]/route.ts"), "utf8");
assert.match(freeGet, /free:\s*true/);
assert.match(freeGet, /getCapability/);

// Free rider verify must NOT gain a silent meter in this PR
const freeVerify = readFileSync(join(__dirname, "../app/api/rider/verify/route.ts"), "utf8");
assert.doesNotMatch(freeVerify, /reportRiderVerifyOverage|TOLL1_METER|checkMonthlyUsage/);
assert.match(freeVerify, /verifyRider/);

// Discovery / registry must not be metered by toll code
const discovery = readFileSync(join(__dirname, "../app/api/discovery/route.ts"), "utf8");
assert.doesNotMatch(discovery, /TOLL2_LOOKUP|reportCapabilityLookup/);

// ── Schema validation ──────────────────────────────────────────────────────
assert.equal(validateCapabilityUpsert(null).ok, false);
assert.equal(validateCapabilityUpsert({}).ok, false);
assert.equal(validateCapabilityUpsert({ agent_id: "a1" }).ok, false);

const ok = validateCapabilityUpsert({
  agent_id: "a1",
  name: "compress.silesia.decode_ok",
  summary: "Lossless compress",
  tags: ["compression"],
  evidence: { kind: "self_asserted" },
});
assert.equal(ok.ok, true);
assert.equal(ok.value.trust.evidence_level, "L0_self");
assert.equal(ok.value.honesty.live, true);

const l1 = validateCapabilityUpsert({
  agent_id: "a1",
  name: "cap.l1",
  evidence: { kind: "rider_receipt", refs: ["https://example/receipt.json"] },
});
assert.equal(l1.ok, true);
assert.equal(l1.value.trust.evidence_level, "L1_receipt");
assert.equal(isVerifiedEvidenceLevel("L1_receipt"), true);
assert.equal(isVerifiedEvidenceLevel("L0_self"), false);

const l3 = validateCapabilityUpsert({
  agent_id: "a1",
  name: "cap.l3",
  evidence: { kind: "host_attest" },
  trust: { evidence_level: "L3_attest" },
});
assert.equal(l3.ok, true);
assert.equal(l3.value.honesty.live, false);
assert.match(l3.value.honesty.parked_note, /PARKED/);
assert.equal(honestyForLevel("L3_attest").live, false);

const mismatch = validateCapabilityUpsert({
  agent_id: "a1",
  name: "bad",
  evidence: { kind: "host_attest" },
  trust: { evidence_level: "L1_receipt" },
});
assert.equal(mismatch.ok, false);
assert.equal(mismatch.error, "evidence_mismatch");

// ── Evidence filter: L0 excluded from verified_only results ────────────────
const caps = [
  {
    capability_id: "cap_l0",
    agent_id: "a1",
    name: "self.only",
    summary: "compress decode",
    tags: ["compression"],
    interfaces: [],
    evidence: { kind: "self_asserted" },
    trust: { evidence_level: "L0_self", agent_trust_score: 90 },
    placement: { promoted: false, promoted_until: null },
    honesty: { live: true, parked_note: null },
  },
  {
    capability_id: "cap_l1",
    agent_id: "a2",
    name: "compress.decode_ok",
    summary: "compress decode_ok receipt",
    tags: ["compression"],
    interfaces: [{ kind: "mcp", url: "https://example/mcp" }],
    evidence: { kind: "rider_receipt", refs: ["r1"] },
    trust: { evidence_level: "L1_receipt", agent_trust_score: 40 },
    placement: { promoted: false, promoted_until: null },
    honesty: { live: true, parked_note: null },
  },
  {
    capability_id: "cap_l2",
    agent_id: "a3",
    name: "compress.exact",
    summary: "exactness",
    tags: ["compression"],
    interfaces: [],
    evidence: { kind: "cuni_exactness" },
    trust: { evidence_level: "L2_exactness", agent_trust_score: 50 },
    placement: { promoted: true, promoted_until: null },
    honesty: { live: true, parked_note: null },
  },
];

const verified = filterAndRankCapabilities(caps, {
  query: "compress",
  tags: ["compression"],
  min_evidence: "L1_receipt",
  verified_only: true,
  limit: 10,
});
assert.equal(verified.some((m) => m.evidence_level === "L0_self"), false);
assert.equal(verified.every((m) => m.verified === true), true);
assert.ok(verified.some((m) => m.capability_id === "cap_l1"));
assert.ok(verified.some((m) => m.capability_id === "cap_l2"));
// Promoted L2 should rank above plain L1 for same tag query
assert.equal(verified[0].capability_id, "cap_l2");

const withL0 = filterAndRankCapabilities(caps, {
  min_evidence: "L0_self",
  verified_only: false,
  limit: 10,
});
assert.ok(withL0.some((m) => m.capability_id === "cap_l0" && m.verified === false));

// ── JSON schema + SQL + docs present ───────────────────────────────────────
const schema = JSON.parse(readFileSync(join(root, "schemas/capability.schema.json"), "utf8"));
assert.deepEqual(schema.properties.trust.properties.evidence_level.enum, [
  "L0_self",
  "L1_receipt",
  "L2_exactness",
  "L3_attest",
]);

const sql = readFileSync(join(root, "supabase/capabilities.sql"), "utf8");
assert.match(sql, /CREATE TABLE IF NOT EXISTS capabilities/);
assert.match(sql, /Do NOT meter \/api\/discovery/);

const docs = readFileSync(join(root, "docs/TOLL_1_2.md"), "utf8");
assert.match(docs, /TOLL1_METER_LIVE/);
assert.match(docs, /TOLL2_LOOKUP_LIVE/);
assert.match(docs, /TOLL2_PROMOTE_LIVE/);
assert.match(docs, /llms\.txt/);
assert.match(docs, /100/);

const flags = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
assert.match(flags, /toll1_meter_off/);
assert.match(flags, /toll2_lookup_off/);
assert.match(flags, /toll2_promote_off/);

const stripe = readFileSync(join(__dirname, "stripe.ts"), "utf8");
assert.match(stripe, /reportRiderVerifyOverage/);
assert.match(stripe, /reportCapabilityLookup/);
assert.match(stripe, /STRIPE_RIDER_VERIFY_METER_NAME/);
assert.match(stripe, /STRIPE_CAPABILITY_LOOKUP_METER_NAME/);

console.log("toll-1-2.selftest: ok (flags off, schema, L0 excluded from verified lookup)");
