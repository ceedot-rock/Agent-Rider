/**
 * Rider renewal tokens — automatic, secure renewal for the fixed 15m rider.
 *
 * Disk-only (no SUPABASE_* env): exercises the disk store backend.
 * Run: cd src && npm run selftest:rider-renewal
 *
 * Covers: renew happy path (claims preserved, rider still 15m), rotation
 * (old token single-use), reuse detection (chain + agent-wide burn, no token
 * values in logs), independent revocation, expired token, wrong-agent
 * binding, unknown/missing token, TTL config, hashes-only storage, and
 * source guards (no expiry parameter on the renew path).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

// Isolate the disk store: rider-renewal.ts resolves data/*.json from cwd.
process.chdir(mkdtempSync(join(tmpdir(), "rider-renewal-")));

// ES256 keypair for rider mint/verify (lib/rider.ts reads env lazily).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.env.RIDER_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.RIDER_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();

const renewal = await import("./rider-renewal.ts");
const { verifyRider } = await import("./rider.ts");
const __dirname = dirname(fileURLToPath(import.meta.url));

// Capture console.error to prove reuse-detection logs never carry token values.
const errLines = [];
const origError = console.error;
console.error = (...a) => {
  errLines.push(a.map(String).join(" "));
  origError(...a);
};

const codeIs = (code) => (err) => err && err.code === code;
const claims = (agent) => ({
  agent_id: agent,
  operator_id: "selftest",
  level: "L1",
  scopes: ["*"],
  layer_from: "agent",
  layer_to: "human",
});
const uid = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// --- 1. happy path + rotation -------------------------------------------
const agentA = uid("agent-a");
const m1 = await renewal.mintRenewalToken(agentA, claims(agentA));
assert.match(m1.renewal_token, /^rrt_[0-9a-f]{48}$/);
assert.equal(m1.expires_in, 2592000);

const r1 = await renewal.redeemRenewalToken(m1.renewal_token);
assert.equal(r1.expires_in, 900, "riders stay 15m fixed");
assert.equal(r1.agent_id, agentA);
assert.notEqual(r1.renewal_token, m1.renewal_token, "rotation issues a new token");
const v1 = await verifyRider(r1.rider);
assert.equal(v1.valid, true);
assert.equal(v1.rider.agent_id, agentA);
assert.equal(v1.rider.level, "L1", "renew preserves the issued claims");
assert.deepEqual(v1.rider.scopes, ["*"]);
assert.equal(v1.rider.exp - v1.rider.iat, 900, "renewed rider is a 15m JWT");

// rotation: the fresh token keeps the chain alive
const r2 = await renewal.redeemRenewalToken(r1.renewal_token);
assert.equal(r2.expires_in, 900);
assert.notEqual(r2.renewal_token, r1.renewal_token);

// --- 2. reuse detection: presenting a rotated token burns the agent --------
const mOther = await renewal.mintRenewalToken(agentA, claims(agentA)); // second chain, same agent
await assert.rejects(renewal.redeemRenewalToken(r1.renewal_token), codeIs("token_reused"));
await assert.rejects(
  renewal.redeemRenewalToken(r2.renewal_token),
  codeIs("token_revoked"),
  "rotated successor is dead after the burn"
);
await assert.rejects(
  renewal.redeemRenewalToken(mOther.renewal_token),
  codeIs("token_revoked"),
  "the agent's other chain is burned too"
);
for (const t of [r1.renewal_token, r2.renewal_token, mOther.renewal_token]) {
  assert.equal(
    errLines.some((l) => l.includes(t)),
    false,
    "reuse-detection logs must never carry token values"
  );
}

// --- 3. independent revocation -------------------------------------------
const agentB = uid("agent-b");
const mB = await renewal.mintRenewalToken(agentB, claims(agentB));
const rev = await renewal.revokeRenewalToken(mB.renewal_token);
assert.equal(rev.agent_id, agentB);
await assert.rejects(renewal.redeemRenewalToken(mB.renewal_token), codeIs("token_revoked"));
await assert.rejects(
  renewal.revokeRenewalToken(`rrt_${"0".repeat(48)}`),
  codeIs("invalid_renewal_token")
);

// --- 4. expired renewal token --------------------------------------------
process.env.RIDER_RENEWAL_TTL_SECONDS = "1";
const agentC = uid("agent-c");
const mC = await renewal.mintRenewalToken(agentC, claims(agentC));
assert.equal(mC.expires_in, 1);
await new Promise((r) => setTimeout(r, 1100));
await assert.rejects(renewal.redeemRenewalToken(mC.renewal_token), codeIs("token_expired"));
delete process.env.RIDER_RENEWAL_TTL_SECONDS;

// --- 5. wrong-agent binding ------------------------------------------------
const agentD = uid("agent-d");
const mD = await renewal.mintRenewalToken(agentD, claims(agentD));
await assert.rejects(
  renewal.redeemRenewalToken(mD.renewal_token, `${agentD}-impostor`),
  codeIs("wrong_agent")
);
const rD = await renewal.redeemRenewalToken(mD.renewal_token);
assert.equal(rD.agent_id, agentD, "failed binding check must not consume the token");
const rD2 = await renewal.redeemRenewalToken(rD.renewal_token, agentD);
assert.equal(rD2.agent_id, agentD, "matching binding succeeds");

// --- 6. unknown / missing token -------------------------------------------
await assert.rejects(renewal.redeemRenewalToken(`rrt_${"f".repeat(48)}`), (e) => {
  assert.equal(e.code, "invalid_renewal_token");
  assert.equal(e.status, 401);
  return true;
});
await assert.rejects(renewal.redeemRenewalToken(""), codeIs("missing_renewal_token"));
await assert.rejects(renewal.redeemRenewalToken(undefined), codeIs("missing_renewal_token"));

// --- 7. TTL config: server-side only, sane fallbacks -----------------------
delete process.env.RIDER_RENEWAL_TTL_SECONDS;
assert.equal(renewal.renewalTtlSeconds(), 2592000);
process.env.RIDER_RENEWAL_TTL_SECONDS = "3600";
assert.equal(renewal.renewalTtlSeconds(), 3600);
process.env.RIDER_RENEWAL_TTL_SECONDS = "bogus";
assert.equal(renewal.renewalTtlSeconds(), 2592000);
process.env.RIDER_RENEWAL_TTL_SECONDS = "-5";
assert.equal(renewal.renewalTtlSeconds(), 2592000);
delete process.env.RIDER_RENEWAL_TTL_SECONDS;

// --- 8. storage holds hashes only ------------------------------------------
const agentE = uid("agent-e");
const mE = await renewal.mintRenewalToken(agentE, claims(agentE));
const diskFile = join(process.cwd(), "data", "rider_renewal_tokens.json");
assert.equal(existsSync(diskFile), true);
const rawDisk = readFileSync(diskFile, "utf8");
assert.equal(rawDisk.includes(mE.renewal_token), false, "raw token must never be stored");
assert.equal(
  rawDisk.includes(renewal.hashRenewalToken(mE.renewal_token)),
  true,
  "only the hash is stored"
);

// --- 9. source guards -------------------------------------------------------
const libSrc = readFileSync(join(__dirname, "rider-renewal.ts"), "utf8");
assert.match(libSrc, /token_hash:\s*hashRenewalToken\(token\)/);
const renewRoute = readFileSync(join(__dirname, "../app/api/rider/renew/route.ts"), "utf8");
assert.match(renewRoute, /redeemRenewalToken/);
assert.doesNotMatch(renewRoute, /body\.(ttl|expiry|expires_in|ttlSeconds)/);
const revokeRoute = readFileSync(join(__dirname, "../app/api/rider/renew/revoke/route.ts"), "utf8");
assert.match(revokeRoute, /revokeRenewalToken/);
const issueRoute = readFileSync(join(__dirname, "../app/api/rider/issue/route.ts"), "utf8");
assert.match(issueRoute, /tryMintRenewalToken/);
assert.match(issueRoute, /renewal_token/);

console.error = origError;
console.log("rider-renewal selftest: all assertions passed");
