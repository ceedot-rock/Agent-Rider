# Agent payment paths — live USDC

Identity mint (register → `ar_` → rider JWT): [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md).

Default live hop settle is **Base mainnet USDC** through the **XPay** facilitator
(`https://facilitator.xpay.sh`). That facilitator does not require Coinbase CDP
API keys. Root `GET` on the facilitator may return 404; settle uses `POST /verify`
and `POST /settle`.

`https://x402.org/facilitator` is testnet only. Do not use it on live hops.

## Env (Fly / Vercel production)

```
X402_NETWORK=base
X402_FACILITATOR=https://facilitator.xpay.sh
X402_PAY_TO=0xYourBaseAddress
```

`X402_PAY_TO_BASE` is accepted as an alias for `X402_PAY_TO` if the latter is unset.

Optional (Coinbase CDP facilitator only):

```
X402_FACILITATOR=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
```

Test only: `X402_NETWORK=base-sepolia`

### Facilitator auth

| Facilitator | Auth |
|---|---|
| XPay (`facilitator.xpay.sh`) — **live default** | None. Missing CDP keys do not block settle. |
| Coinbase CDP | JWT from `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (or `CDP_ACCESS_TOKEN`) when those env vars are set. Optional; only used when the facilitator host is CDP. |

`@coinbase/cdp-sdk` remains available for the optional CDP path. It is not required for XPay.

| key_id | Live behavior |
|---|---|
| `x402:<resource>` | 402 accepts Base USDC (+ USDT), or `X-PAYMENT` → facilitator verify/settle |
| `key_site_*` | Same; resource = job_id |
| `stripe:` / `tiun:` | Human attach only |
| `credits:` | 410 |

## Credits vs hop (honesty)

Board **credits** (`key_id=credits:…`, AGC) are **not** a hop currency and stay
off the x402 / XPay / AMP settle path. `POST /api/settle` rejects them with
**410** (`reject.agc_removed`) once a rider is present. Without a rider the
gate answers first: **401** `missing_rider`.

Live hop settle uses **x402** (`key_id=x402:<resource>` + `X-PAYMENT`) through
the XPay facilitator. AMP is a later dual-rail; it must not spend board credits.
Status + flip checklist: [`AMP_MILESTONE.md`](./AMP_MILESTONE.md). Eng blockers:
[`AMP_INTEGRATION_SKETCH.md`](./AMP_INTEGRATION_SKETCH.md). Concept map:
[`AMP_RIDER_MAP.md`](./AMP_RIDER_MAP.md).

## Smoke (CI / local)

Automated pass/fail for the SettleHop dual-rail honesty checks. Exit **0** on
pass, **non-zero** on fail. No CDP keys, no rider secrets, no real USDC.

```bash
# from repo root
node src/lib/settle-hop.selftest.mjs

# or from src/
npm run smoke:settle
```

What it covers:

1. **XPay facilitator dry** — default facilitator is `https://facilitator.xpay.sh`;
   missing CDP keys do not attach `Authorization`. Mock verify/settle posts go
   to XPay only. Live `POST /verify` with an empty/unauthenticated JSON body
   must **not** return 401/403 (expected: validation failure such as **400**
   `missing_parameters` / `isValid: false`).
2. **Credits reject** — `credits:` / `credits:board` parse as the credits rail;
   documented hop reject is **410** `reject.agc_removed` (credits stay off hop).
3. **Live gate (optional)** — unauthenticated `POST https://agentrider.fly.dev/api/settle`
   → **401** `missing_rider`. Skip with `SKIP_LIVE=1`. Override base with
   `LIVE_BASE=https://…`.

Expected status codes (summary):

| Probe | Expected |
|---|---|
| XPay `POST /verify` empty body | not 401/403 (typically 400 validation) |
| Hop `credits:*` (after rider) | 410 `reject.agc_removed` |
| Live `/api/settle` no rider | 401 `missing_rider` |
