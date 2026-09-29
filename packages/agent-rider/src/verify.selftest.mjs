import { verifyRiderCredential } from "./verify.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.alg = "ES256";
jwk.use = "sig";
jwk.kid = "test-kid";
const jwks = { keys: [jwk] };

async function mint(claims) {
  const header = { alg: "ES256", typ: "JWT", kid: jwk.kid };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(`${h}.${p}`)
    )
  );
  return `${h}.${p}.${b64url(sig)}`;
}

const now = Math.floor(Date.now() / 1000);
const good = await mint({
  iss: "agentrider.dev",
  iat: now,
  exp: now + 900,
  agent_id: "agt_exam",
  operator_id: "external",
  level: "L1",
  scopes: ["*"],
  jti: "jti-good",
});
const goodResult = await verifyRiderCredential(good, { jwks, revoked: [], now });
assert(goodResult.valid === true && goodResult.rider.level === "L1", "good credential should verify");

const killed = await mint({
  iss: "agentrider.dev",
  iat: now,
  exp: now + 900,
  agent_id: "agt_exam",
  operator_id: "external",
  level: "L1",
  scopes: ["*"],
  jti: "jti-dead",
});
const dead = await verifyRiderCredential(killed, { jwks, revoked: [{ jti: "jti-dead" }], now });
assert(dead.valid === false && dead.reason === "revoked", "revoked jti must fail");

const stale = await mint({
  iss: "agentrider.dev",
  iat: now - 1000,
  exp: now - 10,
  agent_id: "agt_exam",
  operator_id: "external",
  level: "L0",
  scopes: ["*"],
  jti: "jti-old",
});
const expired = await verifyRiderCredential(stale, { jwks, revoked: [], now });
assert(expired.valid === false && expired.reason === "expired", "expired must fail");

const [h, p, s] = good.split(".");
const flipped = `${h}.${p}.${s.slice(0, -2)}aa`;
const badSig = await verifyRiderCredential(flipped, { jwks, revoked: [], now });
assert(badSig.valid === false && badSig.reason === "bad_signature", "tamper must fail");

const missingList = await verifyRiderCredential(good, {
  jwks,
  now,
  fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
});
assert(
  missingList.valid === false && missingList.reason === "revocation_unavailable",
  "missing list must fail closed"
);

console.log("rider verify selftest ok");
