# Agent payment paths — USDC on Base and Solana

Same asset. Two chains. Two receive addresses. One protocol (x402 exact).

| Chain | Network id | USDC | Receive env |
|---|---|---|---|
| Base | `eip155:8453` (also `base`) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `X402_PAY_TO_BASE` |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (also `solana-mainnet-beta`) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `X402_PAY_TO_SOLANA` |

Do not put a Solana base58 address in an EVM `payTo` or a `0x` in a Solana accept.

`X402_PAY_TO` is legacy: `0x…` → Base, anything else → Solana.

Facilitator live: CDP `https://api.cdp.coinbase.com/platform/v2/x402` + `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`.
`https://x402.org/facilitator` only if `X402_NETWORK=base-sepolia`.

Storefront `POST /api/x402-products` already builds the same two-accept list when both pay-tos are set. Probe on 2026-09-15 only saw Solana because Base pay-to was empty.

| key_id | Behavior |
|---|---|
| `x402:<resource>` | 402 accepts Base + Solana USDC, or X-PAYMENT → verify/settle the matching rail |
| `stripe:` / `tiun:` | Human attach |
| `credits:` | 410 |
