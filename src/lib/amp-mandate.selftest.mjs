/**
 * AMP mandate-chain shape selftest (offline CI fixture).
 *
 * Documents SD-JWT L1/L2/L3 expectations from public ant-intl/AMP
 * mandate_chain patterns. Does NOT claim live AMP settle.
 *
 * Run (repo root or src):
 *   node src/lib/amp-mandate.selftest.mjs
 *   cd src && npm run selftest:amp
 *
 * Companion: docs/AMP_MILESTONE.md
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMP_ALG,
  AMP_SD_JWT_TYP,
  HOST_HONESTY,
  LAYER_ROLES,
  LAYER_SD,
  MODES,
  assertL1Shape,
  assertL2Shape,
  assertL3Shape,
  buildOfflineFixtures,
  computeSdHash,
  verifySdHashBinding,
} from "./amp-mandate-shape.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(`${name}: ${err.message || err}`);
    console.error(`FAIL  ${name}: ${err.message || err}`);
  }
}

check("honesty_amp_not_live", () => {
  assert.equal(HOST_HONESTY.amp_settle_live, false, "AMP settle must not be marked live");
  assert.equal(HOST_HONESTY.hop_default, "XPay", "hop default remains XPay");
  assert.equal(HOST_HONESTY.signed_neq_kyc, true, "signed ≠ KYC lock");
  assert.match(HOST_HONESTY.rider_clearance_vs_amp_assurance, /L0–L4.*L1–L3/);
});

check("milestone_doc_present_and_not_live", () => {
  const path = join(repoRoot, HOST_HONESTY.milestone_doc);
  assert.ok(existsSync(path), `${HOST_HONESTY.milestone_doc} must exist`);
  const md = readFileSync(path, "utf8");
  assert.match(md, /NOT live settle/i, "milestone must say AMP is NOT live settle");
  assert.match(md, /XPay/i, "milestone must name XPay as live default");
  assert.match(md, /signed.*KYC|signed ≠ KYC/i, "milestone must keep signed ≠ KYC");
  assert.doesNotMatch(md, /\bar_[A-Za-z0-9]{8,}/, "no ar_ secrets in milestone");
});

check("layer_roles_documented", () => {
  assert.ok(LAYER_ROLES.L1 && LAYER_ROLES.L2 && LAYER_ROLES.L3);
  assert.equal(AMP_SD_JWT_TYP, "sd+jwt");
  assert.equal(AMP_ALG, "ES256");
  assert.deepEqual(LAYER_SD.L1, []);
});

check("l1_shape_and_no_sd", () => {
  const { l1 } = buildOfflineFixtures();
  assertL1Shape(l1);
  let threw = false;
  try {
    assertL1Shape({ ...l1, _sd: ["x"] });
  } catch {
    threw = true;
  }
  assert.ok(threw, "L1 with _sd must fail");
});

check("l2_immediate_no_cnf", () => {
  const { l2Immediate, l1Serialized } = buildOfflineFixtures();
  assertL2Shape(l2Immediate, { mode: MODES.IMMEDIATE });
  assert.ok(verifySdHashBinding(l2Immediate, l1Serialized), "L2 IMMEDIATE sd_hash binds L1");
  let threw = false;
  try {
    assertL2Shape({ ...l2Immediate, cnf: { jwk: {} } }, { mode: MODES.IMMEDIATE });
  } catch {
    threw = true;
  }
  assert.ok(threw, "IMMEDIATE L2 with cnf must fail");
});

check("l2_autonomous_requires_cnf", () => {
  const { l2Autonomous, l1Serialized } = buildOfflineFixtures();
  assertL2Shape(l2Autonomous, { mode: MODES.AUTONOMOUS });
  assert.ok(verifySdHashBinding(l2Autonomous, l1Serialized), "L2 AUTONOMOUS sd_hash binds L1");
  const { cnf, ...noCnf } = l2Autonomous;
  let threw = false;
  try {
    assertL2Shape(noCnf, { mode: MODES.AUTONOMOUS });
  } catch {
    threw = true;
  }
  assert.ok(threw, "AUTONOMOUS L2 without cnf must fail");
  assert.ok(cnf);
});

check("l3_shape_binds_l2_no_cnf", () => {
  const { l3, l2Serialized } = buildOfflineFixtures();
  assertL3Shape(l3);
  assert.ok(verifySdHashBinding(l3, l2Serialized), "L3 sd_hash binds L2");
  let threw = false;
  try {
    assertL3Shape({ ...l3, cnf: { jwk: {} } });
  } catch {
    threw = true;
  }
  assert.ok(threw, "L3 with cnf must fail");
});

check("sd_hash_mismatch_detected", () => {
  const { l2Immediate } = buildOfflineFixtures();
  assert.equal(verifySdHashBinding(l2Immediate, "wrong-prev"), false);
  assert.equal(computeSdHash("a") !== computeSdHash("b"), true);
});

check("settle_route_has_no_amp_live_claim", () => {
  const settle = readFileSync(join(__dirname, "../app/api/settle/route.ts"), "utf8");
  // Soft honesty: no soft "AMP live" / enable-AMP-by-default language in settle route.
  assert.doesNotMatch(settle, /AMP.*live|live.*AMP settle/i);
  assert.doesNotMatch(settle, /\bar_[A-Za-z0-9]{12,}/);
});

check("shape_module_links_upstream", () => {
  const src = readFileSync(join(__dirname, "amp-mandate-shape.mjs"), "utf8");
  assert.match(src, /ant-intl\/AMP/);
  assert.match(src, /mandate_chain/);
  assert.match(src, /AMP_MILESTONE/);
  assert.match(src, /does NOT claim|NOT implement live AMP settle/i);
});

console.log("");
console.log(`amp-mandate selftest: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ok amp-mandate selftest (offline L1/L2/L3 shapes — AMP settle NOT live)");
process.exit(0);
