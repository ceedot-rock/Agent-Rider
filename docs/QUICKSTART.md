# Agent Rider quickstart — signed receipt in one sitting

**Audience:** an agent or integrator who wants a paid-style dry call with a **signed receipt** after only `npm install`.  
**Live host:** https://agentrider.fly.dev (Fly only — do not use vercel.app)  
**Cash face (compression / lab cash):** https://www.slidphilabs.com/pcc **only**  
**Rule:** never commit or print `ar_` vault keys, `RIDER_PRIVATE_KEY`, JWTs in tickets, or wallet keys.

## Honest product split

| Piece | What it is | What it is not |
|---|---|---|
| **PCC** | Hosted lossless compressor (Shared Spine door). Cash face `/pcc`. | Not identity. Not settle. Not a payment setting. |
| **TNSSRC** | Local engine of the same spine. Claimable board stamp **43.72M** Silesia (not a #1 claim). | Not the hosted cash door. |
| **Rider** | Signed agent identity (ES256 JWT L0–L4), DMs, JWKS verify, MCP, hop settle (x402 / XPay). | Not a compressor. **Not a cash door (and not a second one).** |
| **Warrant** | Mandate + receipts bound to a Rider. | Not storage pricing. |

**Acronyms (once):** JWT = signed ride credential · JWKS = public keys to verify that signature · MCP = tool endpoint agents call · x402 = HTTP payment challenge (402 + `X-PAYMENT`) · USDC = stablecoin on Base for live hop settle.

## Done means

1. `cd packages/agent-rider-quickstart && npm install && node quickstart.mjs`
2. You get a **signed rider** (sandbox key **or** ephemeral free seat).
3. You get a **verified receipt** (`ok: true`) via JWKS ES256 + `POST /api/rider/verify`.
4. No Fly login, no wallet, no funded USDC for this dry path.

**npm publish:** HOLD until CoS greens — package is `"private": true`.

## Run (dry — no money)

```bash
cd packages/agent-rider-quickstart
npm install
node quickstart.mjs
```

Expected: JSON with `"ok": true`, `verified.jwks_es256: true`, and `cash_face: "https://www.slidphilabs.com/pcc"`.

### Auth modes

| Mode | Client env | Server env (Fly) | Money? |
|---|---|---|---|
| **Sandbox** | `RIDER_SANDBOX_KEY` (documented conventional value `ar_sandbox_demo` when Fly matches) | `RIDER_SANDBOX_API_KEY` set to the same string | No — dry only |
| **Ephemeral seat** (default fallback today) | none | none | No — `POST /api/agents` then issue L1 |

Optional header on issue: `X-Rider-Sandbox: 1`.

Sandbox riders are **read/verify only**. They **cannot** complete funded settle (`X-PAYMENT` → **403** `sandbox_forbidden`) or MCP spend/mutate tools.

Until Ship sets `RIDER_SANDBOX_API_KEY` on Fly, the quickstart **falls back** to ephemeral register (still free, still verifies).

## MCP (sandbox / free test)

- Endpoint: `POST https://agentrider.fly.dev/api/mcp` (streamable HTTP)
- Tools: `register` · `issue_rider` · `verify_rider` · dry list tools
- `issue_rider` with the public sandbox key (when armed) → `mode: "sandbox"`
- `issue_rider` with a vaulted `ar_` from `register` → `mode: "live"` (still L1 self-service)
- Spend tools reject sandbox riders (`sandbox_forbidden`)

## Flip to paid (optional — not required for quickstart)

1. Vault a real `ar_` from `POST /api/agents` or MCP `register` (shown once).
2. `POST /api/rider/issue` with `Authorization: Bearer ar_…` → `X-Agent-Rider` JWT.
3. **Funded Base USDC hop** (operator only): see [`SETTLE_SMOKE.md`](./SETTLE_SMOKE.md) — requires `SETTLE_FUNDED=1` + wallet secrets. Fail-closed without them.
4. **Cash CTA for compression / lab cash remains** [https://www.slidphilabs.com/pcc](https://www.slidphilabs.com/pcc) — do not add a Rider cash door.

Identity join path: [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md) · rails: [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md).

## Verify offline

```text
GET https://agentrider.fly.dev/.well-known/jwks.json   # ES256, iss=agentrider.dev
POST https://agentrider.fly.dev/api/rider/verify        # body: { "rider": "<JWT>" }
```

## Selftests

```bash
# from repo root
node src/lib/sandbox.selftest.mjs
node src/lib/quickstart.selftest.mjs

# or
cd src && npm run selftest:sandbox && npm run selftest:quickstart
```

## Env names (values never in git)

| Name | Where | Purpose |
|---|---|---|
| `RIDER_SANDBOX_API_KEY` | Fly / server | Public sandbox key the host accepts for dry mint |
| `RIDER_SANDBOX_KEY` | Client | Same string the quickstart sends as Bearer |
| `LIVE_BASE` | Client optional | Default `https://agentrider.fly.dev` |
| `SETTLE_FUNDED` | Operator machine only | Arms funded USDC smoke — **not** for dry demo |
| `AR_API_KEY` / `SETTLE_PAYER_PRIVATE_KEY` | Operator only | Funded path — never commit |

## Related

- Settle dry / funded: [`SETTLE_SMOKE.md`](./SETTLE_SMOKE.md)
- Operator join: [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md)
- Package: `packages/agent-rider-quickstart/` · example copy: `examples/quickstart.mjs`
