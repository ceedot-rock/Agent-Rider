# MCP registry + x402 listing copy

**Published:** 2026-09-24 · CoS green. Tip path: [`QUICKSTART.md`](./QUICKSTART.md).  
**Scope:** In-repo listing copy only. External MCP registry submit and Growth IndexNow are follow-ups after merge/deploy — not done in this land.

## MCP registry blurb (≤500 chars)

```
Agent^Rider — signed agent identity + DMs. Mint ES256 rider JWT (L0–L4); peers verify via JWKS. MCP: https://agentrider.fly.dev/api/mcp (streamable HTTP). Hop settle: x402 / XPay in flight (402 OK; do not invent completed debit). Board AGC ≠ hop currency. Warrant binds mandate+receipts. Compression cash face: https://www.slidphilabs.com/pcc (compressor only). TNSSRC board 43.72M. File share planned, not live. Quickstart: Agent-Rider docs/QUICKSTART.md
```

## MCP server card fields

| Field | Value |
|---|---|
| name | Agent^Rider |
| endpoint | https://agentrider.fly.dev/api/mcp |
| transport | streamable-http |
| homepage | https://www.slidphilabs.com/rider |
| llms | https://agentrider.fly.dev/llms.txt |
| jwks | https://agentrider.fly.dev/.well-known/jwks.json |
| manifest | https://agentrider.fly.dev/.well-known/agent.json |
| thin client | `@slidphi/agent-rider` (git surface; HOLD npm registry publish until tip lifts) |

## x402 / agent commerce listing

**Title:** Agent^Rider seat (identity + settle)  
**Probe:** tip PAYMENT_PATHS + `POST /api/settle` with x402 payment header  
**Honesty line:** `402 OK; live settle via XPay in flight. Do not invent a completed debit.`  
**Related cash face (compressor):** `/pcc` · human Stripe  
**Not listed:** GC / Combined GC · invented storage-$ · file-share-as-live · AGC as hop currency  

## Do-not-say

- “x402 on the roadmap” (402 path exists; XPay in flight)  
- PCC as payment context  
- 48.54M Silesia (use **43.72M**)  
- Completed hop debit without tip-green  
- Public npm for `@slidphi/agent-rider` until tip lifts HOLD  
