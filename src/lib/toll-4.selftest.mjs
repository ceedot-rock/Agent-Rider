/**
 * Toll 4 — delegation grants: pure-core logic + route/flag source-shape checks.
 * Ports ~/workspace/rider-toll/tollkeeper/test_grants.py (all 9 check reasons,
 * stale revocation fail-closed, cap math, grant-id determinism, usdc
 * conversion refusals) plus route honesty assertions.
 * No network, no secrets — ephemeral dev keypairs only.
 * Run: cd src && npm run selftest:toll-4
 */
import assertBase from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  signTollPayload,
  verifyTollEnvelope,
  devTollKeypair,
  jwksForTest,
} from "./toll-receipt-core.mjs";
import {
  ISSUE_TOLL_UUSDC,
  CHECK_TOLL_UUSDC,
  DEFAULT_REVOCATION_MAX_AGE,
  Toll4GrantError,
  usdcToUusdc,
  grantIdFor,
  buildGrantPayload,
  buildRevocationPayload,
  checkGrantPure,
} from "./toll-4-core.mjs";

// ── assertion counter ──────────────────────────────────────────────────────
let assertions = 0;
function eq(a, b, msg) { assertions++; assertBase.equal(a, b, msg); }
function deq(a, b, msg) { assertions++; assertBase.deepEqual(a, b, msg); }
function ok(a, msg) { assertions++; assertBase.ok(a, msg); }
function throws(fn, cls, msg) { assertions++; assertBase.throws(fn, cls, msg); }
function match(s, re, msg) { assertions++; assertBase.match(s, re, msg); }
function noMatch(s, re, msg) { assertions++; assertBase.doesNotMatch(s, re, msg); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const NOW = 1_750_000_000; // fixed epoch for determinism

const { privateKey, publicKey, kid } = devTollKeypair("test-grants-1");
const jwks = jwksForTest(publicKey, kid);

const other = devTollKeypair("attacker");
const otherJwks = jwksForTest(other.publicKey, other.kid);

function grantArgs(overrides = {}) {
  return {
    grantor: "principal-1",
    agent_id: "agent-7",
    scope: ["compress", "decompress"],
    cap_uusdc: 2_000_000, // $2.00
    not_before: NOW - 10,
    not_after: NOW + 3600,
    issued_at: NOW,
    ...overrides,
  };
}

function makeEnvelope(overrides = {}) {
  const built = buildGrantPayload(grantArgs(overrides));
  return signTollPayload(built.payload, { privateKey, kid });
}

function check(env, action, amount, overrides = {}) {
  const payload = verifyTollEnvelope(env, overrides.jwks ?? jwks);
  return checkGrantPure({
    grantPayload: payload,
    action,
    amount_uusdc: amount,
    now: NOW,
    revoked: false,
    revocationCheckedAt: null,
    spentTotal: 0,
    ...overrides,
  });
}

// ── toll constants: 1c = 10_000, 0.5c = 5_000 integer micro-USDC ────────────
eq(ISSUE_TOLL_UUSDC, 10_000);
eq(CHECK_TOLL_UUSDC, 5_000);
eq(DEFAULT_REVOCATION_MAX_AGE, 300);

// ── issuance: returns verifiable envelope ───────────────────────────────────
{
  const built = buildGrantPayload(grantArgs());
  const env = signTollPayload(built.payload, { privateKey, kid });
  const p = verifyTollEnvelope(env, jwks);
  eq(p.type, "delegation-grant");
  eq(p.version, 1);
  eq(p.grantor, "principal-1");
  eq(p.agent_id, "agent-7");
  deq(p.scope, ["compress", "decompress"]);
  eq(p.cap_uusdc, 2_000_000);
  eq(p.revocable, true);
  eq(p.issued_at, NOW);
  ok(p.grant_id.startsWith("gr_"));
  eq(p.grant_id, built.grant_id);
  // revocable:false survives
  const built2 = buildGrantPayload(grantArgs({ revocable: false }));
  eq(built2.payload.revocable, false);
}

// ── issuance: rejects bad inputs (fail closed) ─────────────────────────────
throws(() => buildGrantPayload(grantArgs({ scope: [] })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ cap_uusdc: 0 })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ cap_uusdc: 1.5 })), Toll4GrantError); // floats refused
throws(() => buildGrantPayload(grantArgs({ not_after: NOW - 20 })), Toll4GrantError); // inverted window
throws(() => buildGrantPayload(grantArgs({ grantor: "" })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ agent_id: "" })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ not_before: NOW + 0.5 })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ scope: ["ok", 7] })), Toll4GrantError);
throws(() => buildGrantPayload(grantArgs({ cap_uusdc: true })), Toll4GrantError);

// ── grant_id determinism + cross-impl parity (verified vs Python in dev) ────
{
  const a = buildGrantPayload(grantArgs()).grant_id;
  const b = buildGrantPayload(grantArgs()).grant_id;
  eq(a, b); // same core -> same id
  const c = buildGrantPayload(grantArgs({ cap_uusdc: 1 })).grant_id;
  ok(a !== c); // different core -> different id
  // canonical bytes feed the hash: sorted keys, no spaces, ASCII
  eq(canonicalJson({ b: 1, a: [2, 3] }), '{"a":[2,3],"b":1}');
}

// ── revocation payload ─────────────────────────────────────────────────────
{
  const built = buildGrantPayload(grantArgs());
  const rev = buildRevocationPayload({ grant_id: built.grant_id, revoker: "principal-1", revoked_at: NOW });
  eq(rev.type, "grant-revocation");
  eq(rev.version, 1);
  eq(rev.grant_id, built.grant_id);
  eq(rev.revoker, "principal-1");
  eq(rev.revoked_at, NOW);
  // signs and verifies as an envelope
  const renv = signTollPayload(rev, { privateKey, kid });
  eq(verifyTollEnvelope(renv, jwks).type, "grant-revocation");
  throws(() => buildRevocationPayload({ grant_id: "", revoker: "x" }), Toll4GrantError);
  throws(() => buildRevocationPayload({ grant_id: "gr_1", revoker: "" }), Toll4GrantError);
}

// ── checks ─────────────────────────────────────────────────────────────────
{
  // ok
  const env = makeEnvelope();
  deq(check(env, "compress", 500_000), { allowed: true, reason: "ok" });
}
{
  // scope_miss
  const env = makeEnvelope();
  deq(check(env, "launch-missiles", 1), { allowed: false, reason: "scope_miss" });
}
{
  // cap_exceeded: spent 1.8M, 500k over the 2M cap refused; 200k fits
  const env = makeEnvelope();
  deq(check(env, "compress", 500_000, { spentTotal: 1_800_000 }), { allowed: false, reason: "cap_exceeded" });
  deq(check(env, "compress", 200_000, { spentTotal: 1_800_000 }), { allowed: true, reason: "ok" });
  // exact boundary: spent + amount == cap is allowed
  deq(check(env, "compress", 200_000, { spentTotal: 1_800_000 }), { allowed: true, reason: "ok" });
  deq(check(env, "compress", 200_001, { spentTotal: 1_800_000 }), { allowed: false, reason: "cap_exceeded" });
  // zero-amount check against a fully spent grant is still ok
  deq(check(env, "compress", 0, { spentTotal: 2_000_000 }), { allowed: true, reason: "ok" });
}
{
  // expired
  const env = makeEnvelope({ not_after: NOW - 1 });
  deq(check(env, "compress", 1), { allowed: false, reason: "expired" });
}
{
  // not_yet_valid
  const env = makeEnvelope({ not_before: NOW + 600, not_after: NOW + 3600 });
  deq(check(env, "compress", 1), { allowed: false, reason: "not_yet_valid" });
  // window edge: now == not_before is valid (Python: now < not_before refuses)
  const edge = makeEnvelope({ not_before: NOW, not_after: NOW + 3600 });
  deq(check(edge, "compress", 1), { allowed: true, reason: "ok" });
  // now == not_after is still valid (Python: now > not_after refuses)
  const edge2 = makeEnvelope({ not_before: NOW - 10, not_after: NOW });
  deq(check(edge2, "compress", 1), { allowed: true, reason: "ok" });
}
{
  // revoked
  const env = makeEnvelope();
  deq(check(env, "compress", 1, { revoked: true }), { allowed: false, reason: "revoked" });
}
{
  // stale revocation check fails closed; fresh cached snapshot passes
  const env = makeEnvelope();
  deq(
    check(env, "compress", 1, { revocationCheckedAt: NOW - 400 }),
    { allowed: false, reason: "revocation_check_stale" }
  );
  deq(
    check(env, "compress", 1, { revocationCheckedAt: NOW - 60 }),
    { allowed: true, reason: "ok" }
  );
  // exactly maxAge old is NOT stale (Python: now - checkedAt > maxAge)
  deq(
    check(env, "compress", 1, { revocationCheckedAt: NOW - 300 }),
    { allowed: true, reason: "ok" }
  );
  deq(
    check(env, "compress", 1, { revocationCheckedAt: NOW - 301 }),
    { allowed: false, reason: "revocation_check_stale" }
  );
  // staleness beats later reasons: revoked + stale -> stale
  deq(
    check(env, "compress", 1, { revoked: true, revocationCheckedAt: NOW - 400 }),
    { allowed: false, reason: "revocation_check_stale" }
  );
}
{
  // tampered envelope -> bad_signature (caller-side verify throw)
  const env = makeEnvelope();
  const evil = JSON.parse(JSON.stringify(env));
  evil.payload.scope.push("launch-missiles");
  throws(() => verifyTollEnvelope(evil, jwks));
  // caller maps a verify throw to (false, "bad_signature"), still metered
  let refused = false;
  try {
    verifyTollEnvelope(evil, jwks);
  } catch {
    refused = true;
  }
  ok(refused);
}
{
  // wrong key -> bad_signature
  const env = makeEnvelope();
  throws(() => verifyTollEnvelope(env, otherJwks));
}
{
  // malformed_grant: wrong type
  const bad = signTollPayload({ type: "not-a-grant", version: 1 }, { privateKey, kid });
  deq(checkGrantPure({ grantPayload: verifyTollEnvelope(bad, jwks), action: "x", amount_uusdc: 1, now: NOW, revoked: false, spentTotal: 0 }), { allowed: false, reason: "malformed_grant" });
}
{
  // malformed_grant: missing fields
  const thin = signTollPayload({ type: "delegation-grant", version: 1, grant_id: "gr_x" }, { privateKey, kid });
  deq(checkGrantPure({ grantPayload: verifyTollEnvelope(thin, jwks), action: "x", amount_uusdc: 1, now: NOW, revoked: false, spentTotal: 0 }), { allowed: false, reason: "malformed_grant" });
}
{
  // malformed_grant: bad amounts (float / negative / bool)
  const env = makeEnvelope();
  const p = verifyTollEnvelope(env, jwks);
  for (const badAmt of [1.5, -1, true]) {
    deq(checkGrantPure({ grantPayload: p, action: "compress", amount_uusdc: badAmt, now: NOW, revoked: false, spentTotal: 0 }), { allowed: false, reason: "malformed_grant" });
  }
  // non-dict payload
  deq(checkGrantPure({ grantPayload: null, action: "x", amount_uusdc: 1, now: NOW, revoked: false, spentTotal: 0 }), { allowed: false, reason: "malformed_grant" });
}
{
  // default maxAge is 300 when omitted
  const env = makeEnvelope();
  deq(check(env, "compress", 1, { revocationCheckedAt: NOW - 400, maxAge: undefined }), { allowed: false, reason: "revocation_check_stale" });
}

// ── usdcToUusdc: int or integer string only — floats refused ────────────────
eq(usdcToUusdc("2"), 2_000_000);
eq(usdcToUusdc(2), 2_000_000);
eq(usdcToUusdc("0"), 0);
throws(() => usdcToUusdc("-1"), Toll4GrantError);
throws(() => usdcToUusdc(-1), Toll4GrantError);
throws(() => usdcToUusdc(1.5), Toll4GrantError);
throws(() => usdcToUusdc("1.5"), Toll4GrantError);
// DEVIATION from Python (documented): Python accepted Decimal/fractional
// strings like "0.005" -> 5000. JS refuses them — no floats on money.
throws(() => usdcToUusdc("0.005"), Toll4GrantError);
throws(() => usdcToUusdc("abc"), Toll4GrantError);
throws(() => usdcToUusdc(true), Toll4GrantError);
throws(() => usdcToUusdc(undefined), Toll4GrantError);

// ── flags default OFF ──────────────────────────────────────────────────────
const flags = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
match(flags, /isToll4GrantsLive/);
match(flags, /toll4_grants_off/);
match(flags, /TOLL4_GRANTS_OFF_BODY/);
match(flags, /TOLL4_GRANTS_LIVE/);

// ── issue route shape ──────────────────────────────────────────────────────
const issue = readFileSync(join(__dirname, "../app/api/toll/v4/grants/issue/route.ts"), "utf8");
match(issue, /isToll4GrantsLive/);
match(issue, /TOLL4_GRANTS_OFF_BODY/);
match(issue, /status:\s*503/);
match(issue, /resolveTollPayer/);
match(issue, /isTollPayerOk/);
match(issue, /checkMonthlyUsage\(`toll4_issue:\$\{payer\.payer_id\}`,\s*0\)/);
match(issue, /reportToll4GrantIssue/);
match(issue, /signTollPayload/);
match(issue, /buildGrantPayload/);
match(issue, /from\("toll_grants"\)/);
match(issue, /from\("toll_meter"\)/);
match(issue, /t4i_/);
match(issue, /price_usd:\s*PRICE_USD/);
match(issue, /OPTIONS/);

// ── check route shape ──────────────────────────────────────────────────────
const checkSrc = readFileSync(join(__dirname, "../app/api/toll/v4/grants/check/route.ts"), "utf8");
match(checkSrc, /isToll4GrantsLive/);
match(checkSrc, /TOLL4_GRANTS_OFF_BODY/);
match(checkSrc, /status:\s*503/);
match(checkSrc, /resolveTollPayer/);
match(checkSrc, /isTollPayerOk/);
match(checkSrc, /checkMonthlyUsage\(`toll4_check:\$\{payer\.payer_id\}`,\s*0\)/);
match(checkSrc, /reportToll4GrantCheck/);
match(checkSrc, /verifyTollEnvelope/);
match(checkSrc, /checkGrantPure/);
match(checkSrc, /missing_jwks/);
match(checkSrc, /bad_signature/);
match(checkSrc, /revocation_check_stale/);
match(checkSrc, /from\("toll_revocations"\)/);
match(checkSrc, /from\("toll_grant_spends"\)/);
match(checkSrc, /from\("toll_meter"\)/);
match(checkSrc, /t4c_/);
match(checkSrc, /price_usd:\s*PRICE_USD/);
match(checkSrc, /OPTIONS/);

// ── stripe reporters + schema tables present ───────────────────────────────
const stripe = readFileSync(join(__dirname, "stripe.ts"), "utf8");
match(stripe, /reportToll4GrantIssue/);
match(stripe, /reportToll4GrantCheck/);

const sql = readFileSync(join(root, "supabase/schema.sql"), "utf8");
match(sql, /CREATE TABLE IF NOT EXISTS toll_grants/);
match(sql, /CREATE TABLE IF NOT EXISTS toll_grant_spends/);
match(sql, /CREATE TABLE IF NOT EXISTS toll_revocations/);
match(sql, /CREATE TABLE IF NOT EXISTS toll_meter/);

// ── no float money in the pure core ────────────────────────────────────────
const core = readFileSync(join(__dirname, "toll-4-core.mjs"), "utf8");
noMatch(core, /\d+\.\d+/); // no float literals on any money path
match(core, /micro-USDC/);
match(core, /ISSUE_TOLL_UUSDC\s*=\s*10_000/);
match(core, /CHECK_TOLL_UUSDC\s*=\s*5_000/);
match(core, /DEFAULT_REVOCATION_MAX_AGE\s*=\s*300/);
// all nine check reasons named in core
for (const r of ["ok", "bad_signature", "malformed_grant", "not_yet_valid", "expired", "revocation_check_stale", "revoked", "scope_miss", "cap_exceeded"]) {
  match(core, new RegExp(`"${r}"`), `core names reason ${r}`);
}
// toll-4-core must not import the DB or routes' TS graph
noMatch(core, /getDB|supabase|NextRequest/);

console.log(`toll-4.selftest: ok (${assertions} assertions)`);
