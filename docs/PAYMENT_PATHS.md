# Agent payment paths

AGC is not in the hop equation.

Clerk POSTs a bound `SettleHop` to `POST /api/settle` with `X-Agent-Rider`.

| key_id | Rail | What happens |
|---|---|---|
| `x402:<resource>` | x402 facilitator | 402 + accepts, or `X-PAYMENT` → verify → settle |
| `key_site_*` (no prefix) | x402 | Same facilitator; resource = `job_id` |
| `stripe:<price>` | Stripe Checkout | Not a hop. 402 `reject.human_attach` → `/api/checkout` |
| `tiun:<product>` | tiun entitlement | Not a hop. 402 `reject.human_attach` |
| `credits:<id>` | AGC | **Gone.** 410 `reject.agc_removed` |

Human rails attach. x402 spends.
