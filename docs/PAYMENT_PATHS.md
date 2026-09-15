# Agent payment paths

Clerk POSTs a bound `SettleHop` to `POST /api/settle` with `X-Agent-Rider`.

| key_id | Rail | What happens |
|---|---|---|
| `credits:<id>` | Rider AGC | Live debit via `spendCredits` service `hop` |
| `key_site_*` (no prefix) | Rider AGC | Same as credits |
| `x402:<resource>` | x402 facilitator | 402 + accepts, or `X-PAYMENT` → verify → settle |
| `stripe:<price>` | Stripe Checkout | **Not a hop.** 402 `reject.human_attach` → `/api/checkout` |
| `tiun:<product>` | tiun entitlement | **Not a hop.** 402 `reject.human_attach` |

Human rails attach the key. Agent rails spend it.

Same x402 numbers as `slidphi-storefront` / `quikgater` (Base Sepolia USDC, facilitator x402.org) unless env overrides `X402_*`.
