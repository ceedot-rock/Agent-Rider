# SettleHop smoke — dry CI + funded Base USDC (operator)

**Live host:** https://agentrider.fly.dev  
**Default facilitator:** XPay `https://facilitator.xpay.sh` (no CDP keys)  
**Hop currency:** Base mainnet USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)  
**Not hop:** board credits (`key_id=credits:…` → **410**). AMP dual-rail is **not** live.

Identity mint (seat → `ar_` → rider JWT): [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md).  
Env / rails table: [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md).

**Rule:** never commit, paste into PRs, or print `ar_` keys, rider JWTs, or wallet private keys.

## What CI can run (no wallet)

```bash
# repo root
node src/lib/settle-hop.selftest.mjs

# or
cd src && npm run smoke:settle
```

Covers XPay dry verify (no auth), credits-rail honesty (**410**), and optional live
unauth settle → **401** `missing_rider`. No USDC spend. Safe for CI.

Funded USDC settle is **not** runnable in CI without operator secrets. The dry
script never attempts a pay.

## Funded smoke script (fail-closed)

```bash
cd src && npm run smoke:settle:funded
```

| Condition | Result |
|---|---|
| Missing `SETTLE_FUNDED=1` **or** missing wallet/`ar_` secrets | **Exit 1** (fail closed). Prints which *names* are missing — never values. |
| `SETTLE_FUNDED=1` + secrets present | Issues JWT → `POST /api/settle` (402 accepts) → signs EIP-3009 → `POST` with `X-PAYMENT` → expects **200**. |

Optional dry entry that **SKIPs** funded unless armed:

```bash
# still runs dry checks; funded step SKIP unless SETTLE_FUNDED=1 + secrets
SETTLE_FUNDED_PROBE=1 node src/lib/settle-hop.selftest.mjs
```

## Operator checklist — live funded Base USDC hop

### A. Server / Fly (already on production for live hops)

| Env | Purpose |
|---|---|
| `X402_NETWORK=base` | Mainnet (not `base-sepolia`) |
| `X402_FACILITATOR=https://facilitator.xpay.sh` | Default; omit CDP keys for XPay |
| `X402_PAY_TO` (or `X402_PAY_TO_BASE`) | Base address that receives USDC |
| `RIDER_PRIVATE_KEY` / `RIDER_PUBLIC_KEY` | Mint/verify rider JWTs |

No Coinbase CDP keys required for XPay.

### B. Operator machine (funded smoke only — never commit)

| Env | Purpose |
|---|---|
| `SETTLE_FUNDED=1` | Arm the spend path |
| `AR_API_KEY` | Vaulted `ar_…` from `POST /api/agents` (alias: `AGENT_RIDER_API_KEY`) |
| `SETTLE_PAYER_PRIVATE_KEY` | `0x…` EOA on Base with enough USDC for the smoke amount |
| `LIVE_BASE` | Optional; default `https://agentrider.fly.dev` |
| `SETTLE_AMOUNT_USD` | Optional; default `0.01` |

Payer wallet must hold Base USDC ≥ amount (6 decimals). Gas is **not** required for
EIP-3009 `transferWithAuthorization` (facilitator submits); the signature authorizes
pull to `payTo` from the 402 `accepts` list.

### C. Manual sequence (same as the funded script)

1. **Mint rider JWT** (15 min):

   ```bash
   BASE=https://agentrider.fly.dev
   # AR_API_KEY already in env — do not echo it
   curl -sS -X POST "$BASE/api/rider/issue" \
     -H "Authorization: Bearer $AR_API_KEY" \
     -H "content-type: application/json" \
     -d '{"level":"L1","scopes":["*"]}'
   # Response: { rider, expires_in, header_to_send: "X-Agent-Rider" }
   # Store rider in a shell var; never log full JWT in tickets.
   ```

2. **Create payment requirement** — call settle **without** `X-PAYMENT`:

   ```bash
   curl -sS -X POST "$BASE/api/settle" \
     -H "content-type: application/json" \
     -H "X-Agent-Rider: $RIDER" \
     -d '{
       "hop_id": "smoke-hop-1",
       "job_id": "smoke-job-1",
       "key_id": "x402:smoke-job-1",
       "amount_usd": 0.01,
       "meter": { "egress_gb": 0, "compute_s": 0, "codec_s": 0 }
     }'
   ```

   Expect **402** with `accepts[]` (scheme `exact`, network `base`, USDC asset,
   `payTo`, `maxAmountRequired`). `error` is `payment_required` (message: Payment Required). Credits keys never belong here.

3. **Pay** — build x402 v1 `X-PAYMENT`: EIP-3009 `TransferWithAuthorization`
   signed by the payer key for `accepts[0]` (value = `maxAmountRequired`,
   `to` = `payTo`, USDC domain name/version from `extra`). Encode JSON or
   base64(JSON) in header `X-PAYMENT`. Prefer `npm run smoke:settle:funded`
   over hand-rolling the typed data.

4. **POST settle** again with the same body + `X-Agent-Rider` + `X-PAYMENT`.

   Expect **200** with `rail: "stablecoin"`, `asset: "USDC"`, `settled.success`.

### D. Expected errors (actionable)

| Status | `error` | Meaning / next step |
|---|---|---|
| 401 | `missing_rider` | Mint JWT — `issue_url` + [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md) |
| 400 | `SettleHop required` | Body needs `hop_id`, `job_id`, `key_id`, `amount_usd`, `meter` |
| 410 | `reject.agc_removed` | Do not use `credits:` on hop — use `x402:` + `X-PAYMENT` |
| 402 | `payment_required` / Payment Required | Sign `accepts` and retry with `X-PAYMENT` — this doc |
| 400 | `bad_x402_header` | `X-PAYMENT` must be JSON or base64(JSON) PaymentPayload |
| 402 | `reject.funds` | Facilitator verify/settle failed — balance, window, payTo, encoding |

## Honesty

- **Facilitator reliability** — `/verify` + `/settle` use `AbortSignal.timeout` (default 25s; `X402_FACILITATOR_TIMEOUT_MS`). Timeout → **504** `reject.facilitator_timeout`; network fail → **502** `reject.facilitator_unreachable`. Happy-path XPay hop unchanged. No AMP soft-fallback.

- **Credits off hop** — always.
- **AMP** — not live; stub only (`AMP_SETTLE_LIVE` OFF). Do not treat as a settle path yet. See [`AMP_SANDBOX.md`](./AMP_SANDBOX.md).
- **This agent box** typically has **no** funded Base wallet or vaulted `ar_` —
  `smoke:settle:funded` should **fail closed** here until an operator injects secrets
  locally (not into the repo).
