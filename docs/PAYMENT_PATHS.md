# Agent payment paths — live USDC

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
