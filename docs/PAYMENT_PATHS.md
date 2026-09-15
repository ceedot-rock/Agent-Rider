# Agent payment paths — live USDC

Default is **Base mainnet USDC** through the CDP facilitator.
`https://x402.org/facilitator` is testnet only. Do not use it on live hops.

## Env (Fly / Vercel production)

```
X402_NETWORK=base
X402_PAY_TO=0xYourBaseAddress
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
```

Optional: `X402_FACILITATOR=https://api.cdp.coinbase.com/platform/v2/x402`
Test only: `X402_NETWORK=base-sepolia`

Need `@coinbase/cdp-sdk` on the server so verify/settle send a CDP JWT. Without those keys, 402 quotes still advertise live USDC/USDT, but settle will fail auth.

| key_id | Live behavior |
|---|---|
| `x402:<resource>` | 402 accepts Base USDC + USDT, or X-PAYMENT → CDP verify/settle |
| `key_site_*` | Same; resource = job_id |
| `stripe:` / `tiun:` | Human attach only |
| `credits:` | 410 |
