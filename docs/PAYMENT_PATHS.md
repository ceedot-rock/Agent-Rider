# Agent payment paths

Hops settle in regular stablecoins (USDC). No AGC. No lab token.

Clerk POSTs a bound `SettleHop` to `POST /api/settle` with `X-Agent-Rider`.
`amount_usd` is USDC (6 decimals on the wire).

Default rail: Base Sepolia USDC via x402 facilitator. Set `X402_NETWORK`, `X402_ASSET`, `X402_PAY_TO`, `X402_FACILITATOR` for Base mainnet USDC when those keys are live.

| key_id | What happens |
|---|---|
| `x402:<resource>` | USDC verify + settle, or 402 with `accepts` |
| `key_site_*` | Same USDC rail; resource = `job_id` |
| `stripe:<price>` | Human attaches fiat → later USDC spend. Not the hop. |
| `tiun:<product>` | Human entitlement. Not the hop. |
| `credits:<id>` | 410. AGC is not a currency here. |
