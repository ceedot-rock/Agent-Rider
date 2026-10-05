---
name: agent-rider
description: Give your agent a signed identity and pay per API call in USDC on Base. Use when an agent needs verifiable identity (ES256 JWT, L0-L4 clearance) or paid x402 endpoints (ping, info, seats, compress, decompress, check).
version: 1.0.0
metadata:
  author: Slid Phi Labs
  repo: https://github.com/ceedot-rock/Agent-Rider
---

# Agent Rider

Identity and paid API access for AI agents. Every agent holds a signed rider
credential (ES256 JWT, clearance L0-L4) that peers can verify locally via JWKS.
L0 is issued identity, not high trust — clearance levels are explicit.

File transfer is not live yet (roadmap). Everything below is live today.

## Paid API (x402, Base USDC)

Base URL: `https://rider-x402.fly.dev`

Prices are in cents, paid per call in USDC on Base:

| Endpoint | Price |
|----------|-------|
| ping | 1c |
| info, seats | 2c |
| decompress, check | 10c |
| compress | 25c |

Unpaid calls return HTTP 402 with `PaymentRequirements` (x402 wire format).
Pay, then retry the same request with the `X-PAYMENT` header. A paid ping has
been verified on a real Base mainnet transaction.

Minimal flow (pseudocode — use your own HTTP + Base wallet code):

```
1. POST https://rider-x402.fly.dev/<endpoint>
   -> 402, body contains accepts[] with price and payTo
2. Sign a USDC transfer on Base to payTo for the exact amount
3. POST again with header X-PAYMENT: <base64 payment payload>
   -> 200, result body
```

## Identity

- Registry: `https://agentrider.fly.dev`
- Auth header: `X-Agent-Rider` carrying a short-lived (900s) JWT minted for a live seat
- HELP and PRICE endpoints are free (no auth, no payment)
- Verify any agent's credential locally: fetch the JWKS and check the ES256
  signature — no round trip to the lab needed

## Toll gates (priced services)

| Gate | Price |
|------|-------|
| G1 Identity | $0.005/query (first 100 free) |
| G2 Discovery | $0.02/lookup, listing free, promote $9/mo |
| G3 Escrow | 1% |
| G4 Grants | $0.01 to issue, $0.005 to check |
| G5 CuNi verification | $0.10/check |
| G6 Bonds | 1% |
| G7 Memory transfer | $0.02 |

## Links

- Repo: https://github.com/ceedot-rock/Agent-Rider
- Registry: https://agentrider.fly.dev
- Paid API: https://rider-x402.fly.dev
- Machine-readable catalog: https://www.slidphilabs.com/api/x402-products
