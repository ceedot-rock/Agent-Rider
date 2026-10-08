# Toll-Gate Corruption Sandbox

**"Let me break a field in staging and watch the gate refuse dispatch."**

The sandbox runs the **exact validation pipelines** of the live toll gates —
signature checks, schema checks, grant policy, revocation lookups — with
**zero side effects**: no DB writes, no attestation signing, no metering, no
settlement, no charge.

## The demo key

```
sk_sandbox_demo
```

Public and documented. Present it as `Authorization: Bearer sk_sandbox_demo`
or `X-Merchant-Key: sk_sandbox_demo` on any covered toll route. It authorizes
**nothing real**:

1. Routes branch to the sandbox handler **before** billing auth runs.
2. `resolveTollPayer` explicitly rejects the demo key (`sandbox_key_not_billable`).
3. Sandbox handlers never sign, write, meter, or settle.

Fail closed everywhere: any error in sandbox mode returns a refusal, never
an allow. Every response carries `sandbox: true`.

## Covered routes

| Route | What runs in sandbox |
|---|---|
| `POST /api/toll/v1/verify` | Full rider-JWT verification |
| `POST /api/toll/v4/grants/check` | Envelope signature → revocation lookup → spend lookup → grant policy |
| `POST /api/toll/v5/check` | Request-shape validation → exactness check |

## Examples

Base URL below is the public deployment; the same paths work on any env
with the toll flags on.

### v5 — a passing check (decision: allow, no attestation minted)

```bash
curl -s https://agentrider.fly.dev/api/toll/v5/check \
  -H "Authorization: Bearer sk_sandbox_demo" \
  -H "Content-Type: application/json" \
  -d '{"artifact":{"lang":"python","code":"print(1)"},
       "claim":{"stdout":"<sha256 of canonical artifact JSON>"}}'
# → {"sandbox":true,"decision":"allow","refusal_code":null,
#    "checks_run":["request_shape","exactness_check"]}
```

Note: even on `allow`, no `envelope` is returned — the demo key can never
mint a real attestation.

### v5 — malformed request

```bash
curl -s https://agentrider.fly.dev/api/toll/v5/check \
  -H "Authorization: Bearer sk_sandbox_demo" \
  -H "Content-Type: application/json" \
  -d '{"artifact":"not-a-dict","claim":{"stdout":"x"}}'
# → HTTP 400 {"sandbox":true,"decision":"refuse",
#    "refusal_code":"malformed_check_request",...}
```

### v5 — exactness refuse (claim doesn't match)

```bash
curl -s https://agentrider.fly.dev/api/toll/v5/check \
  -H "Authorization: Bearer sk_sandbox_demo" \
  -H "Content-Type: application/json" \
  -d '{"artifact":{"lang":"python","code":"print(1)"},
       "claim":{"stdout":"wrong"}}'
# → {"sandbox":true,"decision":"refuse","refusal_code":"exactness_refuse",...}
```

### v4 — tampered signature → `bad_signature`

Generate a fixture with the repo's own modules (any ES256 keypair works —
the sandbox verifies against the JWKS *you* supply):

```bash
cd ~/workspace/Agent-Rider/src && node --input-type=module <<'EOF' > /tmp/grant.json
import * as rc from "./lib/toll-receipt-core.mjs";
import * as toll4 from "./lib/toll-4-core.mjs";
const k = rc.devTollKeypair("demo");
const now = Math.floor(Date.now() / 1000);
const payload = toll4.buildGrantPayload({
  grantor: "you", agent_id: "agent-1", scope: ["compress"],
  cap_uusdc: 2000000, not_before: now - 10,
  not_after: now + 3600, issued_at: now,
}).payload;
const env = rc.signTollPayload(payload, { privateKey: k.privateKey, kid: k.kid });
// corrupt one character of the signature:
const i = 10, s = env.sig;
const tampered = { ...env, sig: s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1) };
console.log(JSON.stringify({
  grant_envelope: tampered,
  jwks: rc.jwksForTest(k.publicKey, k.kid),
  action: "compress", amount_uusdc: 1000,
}));
EOF

curl -s https://agentrider.fly.dev/api/toll/v4/grants/check \
  -H "Authorization: Bearer sk_sandbox_demo" \
  -H "Content-Type: application/json" \
  -d @/tmp/grant.json
# → {"sandbox":true,"decision":"refuse","refusal_code":"bad_signature",
#    "checks_run":["input_shape","envelope_signature"]}
```

Try the other corruptions by editing the fixture: drop `sig` from the
envelope → `malformed_envelope`; verify against a *different* keypair's
JWKS → `unknown_kid`; set `not_after` in the past → `expired`.

### v1 — bogus JWT → refuse

```bash
curl -s https://agentrider.fly.dev/api/toll/v1/verify \
  -H "Authorization: Bearer sk_sandbox_demo" \
  -H "Content-Type: application/json" \
  -d '{"rider":"bogus.token.here"}'
# → {"sandbox":true,"decision":"refuse",
#    "refusal_code":"ERR_JWS_SIGNATURE_VERIFICATION_FAILED",...}
```

## Refusal codes

Sandbox returns the same named codes as the live gates, plus one
refinement:

| Code | Meaning | Live equivalent |
|---|---|---|
| `bad_signature` | Envelope signature invalid / wrong alg | same |
| `unknown_kid` | Signing key not in the supplied JWKS | live collapses to `bad_signature` — sandbox refines it so you can see which check fired |
| `malformed_envelope` | Envelope missing fields / not a dict | live collapses to `bad_signature` at verify, or `malformed_grant` at policy |
| `malformed_grant` | Valid signature, payload isn't a grant | same |
| `expired` / `not_yet_valid` | Grant outside its validity window | same |
| `revoked` | Grant revoked | same |
| `revocation_check_stale` | Revocation state couldn't be proven fresh | same |
| `cap_exceeded` | Spend would exceed cap (or spend state unprovable) | same |
| `scope_miss` | Action not in grant scope | same |
| `malformed_check_request` | v5 artifact/claim shape invalid (HTTP 400) | same |
| `exactness_refuse` | v5 check ran; claim didn't match | live returns `result:"refuse"` |
| `missing_jwks` / `bad_action` / `bad_amount_uusdc` | v4 input shape (HTTP 400) | same |
| `missing_rider` | v1 no token (HTTP 400) | same |
| `toll_store_unavailable` | DB unreachable (HTTP 500, still a refusal) | same |

## What the sandbox does NOT do

- No attestation rows, no meter rows, no Stripe calls, no settlement.
- No `envelope` is ever returned — a sandbox `allow` is a verdict, not a credential.
- The demo key on a non-sandbox toll route → `401 sandbox_key_not_billable`.

## For operators

- Override the demo key with `TOLL_SANDBOX_DEMO_KEY` (it must not start
  with `ar_`; if it does, sandbox detection disables itself fail-safe).
- Tests: `cd src && npm run selftest:toll-sandbox` (82 assertions).

---

# Public attestation (no account)

**"POST a payload, get a signed receipt, verify locally."**

`POST /api/toll/public/attest` — no auth, no account, no billing, no
metering, no DB writes. Anyone can get a lab-signed receipt envelope and
verify it offline against `/.well-known/jwks.json` with standard ES256
tooling. The receipt never phones home.

Two shapes (send exactly one):

| Body | Attests |
|---|---|
| `{"payload": {...}}` | Notarization — "the lab saw this exact payload at time T" (payload hashed into the receipt) |
| `{"artifact": {...}, "claim": {...}}` | Exactness — runs the same check as the v5 toll gate; attests match/mismatch |

Every receipt payload carries `type: "public-attestation"`, `version: 1`,
`mode: "notarization" | "exactness"`, `issuer: "slid-phi-labs"`, and a
timestamp. Envelope is the standard `{payload, sig, kid, alg: "ES256"}`.

## Limits (abuse guards)

- 64 KB raw body cap → `413 payload_too_large`
- Floats refused → `400 floats_refused` (integer-exact canonicalization)
- Per-IP 60 requests/hour → `429 rate_limited` with `retry_after`
  (override with `PUBLIC_ATTEST_MAX_PER_HOUR`; in-process, no DB)
- Missing signing key → `500 signing_unavailable` — fail closed, an
  unsigned receipt is never returned

## Examples

### Notarization

```bash
curl -s https://agentrider.fly.dev/api/toll/public/attest \
  -H "Content-Type: application/json" \
  -d '{"payload":{"treaty":"signed","parties":2}}' | python3 -m json.tool
# → {"public": true, "live": true, "mode": "notarization",
#    "envelope": {"payload": {"type":"public-attestation","version":1,
#      "mode":"notarization","issuer":"slid-phi-labs",
#      "payload_hash":"222559ef…","attested_at":1791476389},
#      "sig":"…","kid":"wr719uYqdFTNlnVKumbmyAcbDqIidey6xupdXHV19jw","alg":"ES256"},
#    "verify": {"jwks_url": "/.well-known/jwks.json", ...}}
```

### Exactness check (same pipeline as the v5 toll gate)

The claim must equal the sha256 of the canonical artifact JSON. Compute
it with the repo's own canonicalizer (sorted keys — plain
`JSON.stringify` will not match):

```bash
STDOUT=$(cd ~/workspace/Agent-Rider/src && node --input-type=module -e "
import { canonicalJson } from './lib/toll-receipt-core.mjs';
import { createHash } from 'node:crypto';
const art = { lang: 'python', code: 'print(1)' };
process.stdout.write(createHash('sha256').update(canonicalJson({ artifact: art }), 'utf8').digest('hex'));")

curl -s https://agentrider.fly.dev/api/toll/public/attest \
  -H "Content-Type: application/json" \
  -d '{"artifact":{"lang":"python","code":"print(1)"},"claim":{"stdout":"'"$STDOUT"'"}}'
# → {"public": true, "mode": "exactness", "result": "pass", "envelope": {...}}
```

A wrong claim returns `"result": "refuse"` — still a signed receipt,
attesting the negative outcome.

### Verify offline (no server contact)

```bash
# 1. Save the envelope from any response above to /tmp/env.json
# 2. Fetch the lab JWKS once (cache it — it outlives us):
curl -s https://agentrider.fly.dev/.well-known/jwks.json > /tmp/jwks.json

# 3. Verify with any JOSE tooling. Node example:
cd ~/workspace/Agent-Rider/src && node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs';
import { verifyTollEnvelope } from './lib/toll-receipt-core.mjs';
const { envelope } = JSON.parse(readFileSync('/tmp/env.json', 'utf8'));
const jwks = JSON.parse(readFileSync('/tmp/jwks.json', 'utf8'));
const payload = verifyTollEnvelope(envelope, jwks); // throws on any failure
console.log('verified offline:', JSON.stringify(payload));
EOF
```

## What it does NOT do

- No account, no API key, no Stripe, no metering rows, no settlement.
- The demo sandbox key (`sk_sandbox_demo`) is rejected here like any
  other credential — this endpoint needs none.
- Tests: `cd src && npm run selftest:toll-public-attest` (43 assertions).
