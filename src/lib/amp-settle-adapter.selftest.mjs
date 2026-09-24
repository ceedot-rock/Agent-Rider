/**
 * AMP settle adapter stub honesty — offline.
 * Run: cd src && npm run selftest:amp-settle-adapter
 *
 * Covers:
 * - flag OFF (default) → fail-closed 501 amp_settle_not_live
 * - flag ON → still fail-closed (not fake success)
 * - POST /api/settle does not call attemptAmpSettle (XPay untouched)
 * - credits: → 410 still present on settle route
 * - recipe + docs honesty
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}: ${err.message || err}`);
  }
}

/** Runtime mirror of amp-settle-adapter.ts — must stay in sync with source text. */
const AMP_SETTLE_LIVE_ENV = "AMP_SETTLE_LIVE";
const AMP_SETTLE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/AMP_SANDBOX.md";
const AMP_MILESTONE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/AMP_MILESTONE.md";

function isAmpSettleLive(env = {}) {
  const raw = env[AMP_SETTLE_LIVE_ENV];
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function attemptAmpSettle(env = {}) {
  const liveFlag = isAmpSettleLive(env);
  return {
    ok: false,
    status: 501,
    body: {
      error: "amp_settle_not_live",
      status: "not_live",
      live: false,
      hop_default: "xpay",
      message: liveFlag
        ? "AMP_SETTLE_LIVE is set but the AMP adapter is still a stub — hop debit stays XPay until a proven adapter lands."
        : "AMP settle is PARKED. Default live hop is XPay (Base USDC / x402). See AMP sandbox recipe.",
      docs_url: AMP_SETTLE_DOCS,
      milestone_url: AMP_MILESTONE_DOCS,
      feature_flag: {
        name: AMP_SETTLE_LIVE_ENV,
        value: liveFlag,
        note: "Default false. Setting true does not enable AMP while only this stub exists.",
      },
    },
  };
}

const src = readFileSync(join(__dirname, "amp-settle-adapter.ts"), "utf8");

check("ts_source_flag_and_fail_closed", () => {
  assert.match(src, /AMP_SETTLE_LIVE/);
  assert.match(src, /amp_settle_not_live/);
  assert.match(src, /hop_default:\s*"xpay"/);
  assert.match(src, /Default false/);
  assert.match(src, /status:\s*501/);
  assert.doesNotMatch(src, /AMP settle is live|live AMP hop|ok:\s*true/i);
});

check("flag_default_off", () => {
  assert.equal(isAmpSettleLive({}), false);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "" }), false);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "false" }), false);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "0" }), false);
});

check("flag_on_parses_true_yes_1", () => {
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "true" }), true);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "TRUE" }), true);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "1" }), true);
  assert.equal(isAmpSettleLive({ AMP_SETTLE_LIVE: "yes" }), true);
});

check("stub_flag_off_fail_closed", () => {
  const r = attemptAmpSettle({});
  assert.equal(r.ok, false);
  assert.equal(r.status, 501);
  assert.equal(r.body.error, "amp_settle_not_live");
  assert.equal(r.body.live, false);
  assert.equal(r.body.hop_default, "xpay");
  assert.equal(r.body.feature_flag.value, false);
  assert.match(r.body.message, /PARKED|XPay/i);
});

check("stub_flag_on_still_fail_closed_not_fake_success", () => {
  const r = attemptAmpSettle({ AMP_SETTLE_LIVE: "true" });
  assert.equal(r.ok, false, "must not fake ok:true when flag on");
  assert.equal(r.status, 501);
  assert.equal(r.body.error, "amp_settle_not_live");
  assert.equal(r.body.live, false);
  assert.equal(r.body.hop_default, "xpay");
  assert.equal(r.body.feature_flag.value, true);
  assert.match(r.body.message, /still a stub|XPay/i);
  assert.doesNotMatch(JSON.stringify(r), /"settled"|success.?settle/i);
});

check("settle_route_xpay_only_no_amp_call", () => {
  const settle = readFileSync(join(__dirname, "../app/api/settle/route.ts"), "utf8");
  assert.doesNotMatch(settle, /attemptAmpSettle|amp-settle-adapter|AMP_SETTLE_LIVE/);
  assert.match(settle, /settleX402|x402|XPay|xpay/i);
});

check("credits_still_410_on_settle_route", () => {
  const settle = readFileSync(join(__dirname, "../app/api/settle/route.ts"), "utf8");
  assert.match(settle, /rail === "credits"/);
  assert.match(settle, /reject\.agc_removed/);
  assert.match(settle, /status:\s*410/);
});

check("recipe_doc_honesty", () => {
  const recipePath = join(repoRoot, "docs/AMP_SANDBOX.md");
  assert.ok(existsSync(recipePath), "AMP_SANDBOX.md must exist");
  const recipe = readFileSync(recipePath, "utf8");
  assert.match(recipe, /AMP_SETTLE_LIVE/);
  assert.match(recipe, /XPay/);
  assert.match(recipe, /human_not_present/);
  assert.match(recipe, /human_present/);
  assert.match(recipe, /not live|PARKED|fail-closed|amp_settle_not_live/i);
  assert.match(recipe, /43\.72M/);
  assert.match(recipe, /\/pcc/);
  assert.doesNotMatch(recipe, /ar_[a-f0-9]{20,}/i);
});

check("honesty_tables_mention_stub", () => {
  const sketch = readFileSync(join(repoRoot, "docs/AMP_INTEGRATION_SKETCH.md"), "utf8");
  assert.match(sketch, /Stub in-tree|stub/i);
  assert.match(sketch, /AMP_SETTLE_LIVE/);
  assert.doesNotMatch(sketch, /No AMP settle adapter in-tree/);
  const milestone = readFileSync(join(repoRoot, "docs/AMP_MILESTONE.md"), "utf8");
  assert.match(milestone, /NOT live settle/i);
  assert.match(milestone, /AMP_SETTLE_LIVE/);
});

check("env_example_flag_default_false", () => {
  const envEx = readFileSync(join(repoRoot, ".env.example"), "utf8");
  assert.match(envEx, /AMP_SETTLE_LIVE=false/);
});

// XPay dry + credits 410 path remains green (spawn settle selftest subset is heavy;
// invoke full smoke — it is offline-safe aside from optional live 401 probe).
check("xpay_settle_smoke_still_green", () => {
  const r = spawnSync(process.execPath, [join(__dirname, "settle-hop.selftest.mjs")], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, SKIP_LIVE: "1" },
    timeout: 60_000,
  });
  if (r.status !== 0) {
    throw new Error(`settle-hop.selftest exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  assert.match(r.stdout, /credits_hop_reject_410/);
  assert.match(r.stdout, /xpay/i);
});

console.log(`\namp-settle-adapter.selftest: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ok amp-settle-adapter (stub OFF default; flag-on fail-closed; XPay + credits 410 intact)");
