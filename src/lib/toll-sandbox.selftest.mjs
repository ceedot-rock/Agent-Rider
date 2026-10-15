/**
 * Toll-gate corruption sandbox selftest.
 *
 * Proves: (a) the demo key can never authorize real dispatch and no sandbox
 * path writes state; (b) each corruption case returns its distinct refusal
 * code; (c) sandbox decisions mirror the live pipelines' verdicts.
 *
 * Pure-core behavioral tests + route honesty assertions (source shape).
 * No network, no DB, no secrets — ephemeral dev keypairs only.
 * Run: cd src && npm run selftest:toll-sandbox
 */
import assertBase from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  signTollPayload,
  devTollKeypair,
  jwksForTest,
} from "./toll-receipt-core.mjs";
import { buildGrantPayload } from "./toll-4-core.mjs";
import {
  DEFAULT_SANDBOX_DEMO_KEY,
  isSandboxCredential,
  sandboxDemoKey,
  classifyEnvelopeError,
  sandboxV4Verify,
  sandboxV4Policy,
  sandboxV5Decide,
  sandboxV1Decide,
} from "./toll-sandbox-core.mjs";

// ── assertion counter ──────────────────────────────────────────────────────
let assertions = 0;
function eq(a, b, msg) { assertions++; assertBase.equal(a, b, msg); }
function deq(a, b, msg) { assertions++; assertBase.deepEqual(a, b, msg); }
function ok(a, msg) { assertions++; assertBase.ok(a, msg); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const NOW = 1_750_000_000; // fixed epoch for determinism

// ── fixtures ───────────────────────────────────────────────────────────────
const grantorKeys = devTollKeypair("sandbox-grantor-1");
const grantorJwks = jwksForTest(grantorKeys.publicKey, grantorKeys.kid);
const attackerKeys = devTollKeypair("sandbox-attacker-1");
const attackerJwks = jwksForTest(attackerKeys.publicKey, attackerKeys.kid);

function grantPayload(overrides = {}) {
  return buildGrantPayload({
    grantor: "principal-1",
    agent_id: "agent-7",
    scope: ["compress", "decompress"],
    cap_uusdc: 2_000_000,
    not_before: NOW - 10,
    not_after: NOW + 3600,
    issued_at: NOW,
    ...overrides,
  }).payload;
}

function signGrant(payload, keys = grantorKeys) {
  return signTollPayload(payload, { privateKey: keys.privateKey, kid: keys.kid });
}

const validArgs = () => ({
  grant_envelope: signGrant(grantPayload()),
  jwks: grantorJwks,
  action: "compress",
  amount_uusdc: 1000,
  revocationCheckedAt: null,
});

/** Full v4 pipeline as the route runs it (verify → injected reads → policy). */
function v4Pipeline(args, dbReads = { revoked: false, spentTotal: 0 }) {
  const pre = sandboxV4Verify(args);
  if (pre.decision === "refuse" || !pre.payload) return pre;
  return sandboxV4Policy({
    payload: pre.payload,
    action: args.action,
    amount_uusdc: args.amount_uusdc,
    revocationCheckedAt: args.revocationCheckedAt ?? null,
    now: NOW,
    revoked: dbReads.revoked,
    spentTotal: dbReads.spentTotal,
    checks_run: pre.checks_run,
  });
}

function tamperSig(env) {
  const s = env.sig;
  const i = 10;
  const ch = s[i] === "A" ? "B" : "A";
  return { ...env, sig: s.slice(0, i) + ch + s.slice(i + 1) };
}

// ── demo-key detection ─────────────────────────────────────────────────────
eq(DEFAULT_SANDBOX_DEMO_KEY, "sk_sandbox_demo");
eq(isSandboxCredential("sk_sandbox_demo", null), true, "bearer demo key");
eq(isSandboxCredential(null, "sk_sandbox_demo"), true, "merchant demo key");
eq(isSandboxCredential("ar_realkey123", null), false, "real-looking key is not sandbox");
eq(isSandboxCredential("wrong", null), false);
eq(isSandboxCredential(null, null), false);
eq(isSandboxCredential("", ""), false);

process.env.TOLL_SANDBOX_DEMO_KEY = "demo2";
eq(sandboxDemoKey(), "demo2");
eq(isSandboxCredential("demo2", null), true, "env override honored");
process.env.TOLL_SANDBOX_DEMO_KEY = "ar_evil";
eq(isSandboxCredential("ar_evil", null), false, "fail-safe: ar_-looking demo key never sandbox");
delete process.env.TOLL_SANDBOX_DEMO_KEY;
eq(isSandboxCredential("sk_sandbox_demo", null), true, "default restored");

// ── envelope error classification ──────────────────────────────────────────
eq(classifyEnvelopeError("unknown kid: abc123"), "unknown_kid");
eq(classifyEnvelopeError("envelope missing field: sig"), "malformed_envelope");
eq(classifyEnvelopeError("envelope must be a dict"), "malformed_envelope");
eq(classifyEnvelopeError("signature verification failed"), "bad_signature");
eq(classifyEnvelopeError("unsupported alg: RS256"), "bad_signature");

// ── v4: the four corruption cases + policy refusals ────────────────────────
{
  const out = v4Pipeline(validArgs());
  eq(out.decision, "allow");
  eq(out.refusal_code, null);
  deq(out.checks_run, ["input_shape", "envelope_signature", "revocation_lookup", "spend_lookup", "grant_policy"]);
  eq(out.http_status, 200);
}
{
  // tampered signature → bad_signature
  const args = validArgs();
  args.grant_envelope = tamperSig(args.grant_envelope);
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "bad_signature");
  deq(out.checks_run, ["input_shape", "envelope_signature"]);
}
{
  // malformed envelope (missing sig field) → malformed_envelope
  const args = validArgs();
  const { sig, ...rest } = args.grant_envelope;
  args.grant_envelope = rest;
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "malformed_envelope");
}
{
  // unknown kid → unknown_kid (sandbox refines live's collapsed bad_signature)
  const args = validArgs();
  args.jwks = attackerJwks;
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "unknown_kid");
}
{
  // expired grant → expired
  const args = validArgs();
  args.grant_envelope = signGrant(grantPayload({ not_before: NOW - 7200, not_after: NOW - 3600 }));
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "expired");
}
{
  // wrong payload type → malformed_grant (signature valid, policy rejects)
  const args = validArgs();
  args.grant_envelope = signGrant({ type: "not-a-grant", version: 1 });
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "malformed_grant");
}
{
  // revoked → revoked
  const out = v4Pipeline(validArgs(), { revoked: true, spentTotal: 0 });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "revoked");
}
{
  // spend over cap → cap_exceeded
  const out = v4Pipeline(validArgs(), { revoked: false, spentTotal: 2_000_000 });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "cap_exceeded");
}
{
  // scope miss → scope_miss
  const args = validArgs();
  args.action = "launch-missiles";
  const out = v4Pipeline(args);
  eq(out.decision, "refuse");
  eq(out.refusal_code, "scope_miss");
}
{
  // missing jwks → missing_jwks, HTTP 400 like live
  const out = v4Pipeline({ ...validArgs(), jwks: null });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "missing_jwks");
  eq(out.http_status, 400);
}
{
  // bad action → bad_action, HTTP 400 like live
  const out = v4Pipeline({ ...validArgs(), action: "" });
  eq(out.refusal_code, "bad_action");
  eq(out.http_status, 400);
}

// ── v5: exactness ──────────────────────────────────────────────────────────
{
  const artifact = { lang: "python", code: "print(1)" };
  const stdout = createHash("sha256").update(canonicalJson({ artifact }), "utf8").digest("hex");
  const out = sandboxV5Decide({ artifact, claim: { stdout } });
  eq(out.decision, "allow");
  eq(out.refusal_code, null);
  deq(out.checks_run, ["request_shape", "exactness_check"]);
}
{
  const out = sandboxV5Decide({ artifact: { lang: "python", code: "print(1)" }, claim: { stdout: "nope" } });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "exactness_refuse");
}
{
  const out = sandboxV5Decide({ artifact: "not-a-dict", claim: { stdout: "x" } });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "malformed_check_request");
  eq(out.http_status, 400);
}

// ── v1: rider-JWT verify mapping ───────────────────────────────────────────
{
  const out = sandboxV1Decide({ token: null, verifyResult: null });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "missing_rider");
  eq(out.http_status, 400);
}
{
  const out = sandboxV1Decide({ token: "bad.token.here", verifyResult: { valid: false, reason: "ERR_JWT_EXPIRED" } });
  eq(out.decision, "refuse");
  eq(out.refusal_code, "ERR_JWT_EXPIRED", "live reason string preserved");
}
{
  const out = sandboxV1Decide({ token: "good.token.here", verifyResult: { valid: true } });
  eq(out.decision, "allow");
  eq(out.refusal_code, null);
}

// ── honesty assertions: sandbox paths write nothing ────────────────────────
{
  const sandboxTs = readFileSync(join(__dirname, "toll-sandbox.ts"), "utf8");
  const sandboxCore = readFileSync(join(__dirname, "toll-sandbox-core.mjs"), "utf8");
  for (const src of [sandboxTs, sandboxCore]) {
    ok(!src.includes(".insert("), "no DB inserts in sandbox code");
    ok(!src.includes(".upsert("), "no DB upserts in sandbox code");
    ok(!src.includes(".update("), "no DB updates in sandbox code");
    ok(!src.includes(".delete("), "no DB deletes in sandbox code");
    ok(!src.includes("signTollPayload("), "sandbox never mints attestations");
    ok(!src.includes("reportToll"), "sandbox never meters via Stripe");
    ok(!src.includes("reportRider"), "sandbox never meters via Stripe");
  }
  ok(!sandboxCore.includes("getDB"), "pure core never touches the DB");
}

// ── honesty assertions: sandbox branches before auth in every route ────────
for (const routePath of [
  "app/api/toll/v1/verify/route.ts",
  "app/api/toll/v4/grants/check/route.ts",
  "app/api/toll/v5/check/route.ts",
]) {
  const src = readFileSync(join(root, "src", routePath), "utf8");
  const sandboxAt = src.indexOf("isSandboxRequest(req)");
  const authAt = src.indexOf("resolveTollPayer(req)");
  ok(sandboxAt !== -1, `${routePath}: sandbox branch present`);
  ok(authAt !== -1, `${routePath}: auth still present`);
  ok(sandboxAt < authAt, `${routePath}: sandbox branches BEFORE auth — demo key never reaches dispatch`);
}

// ── honesty assertions: billing guard rejects the demo key ─────────────────
{
  const billing = readFileSync(join(__dirname, "toll-billing.ts"), "utf8");
  ok(billing.includes("sandbox_key_not_billable"), "toll-billing rejects the demo key explicitly");
}

console.log(`toll-sandbox selftest: ${assertions} assertions green`);
