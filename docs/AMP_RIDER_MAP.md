# AMP ↔ Agent-Rider map

**Status:** dual-rail planning only. Live hop settle remains **XPay** — see [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md).  
**Milestone card:** [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · **Eng sketch:** [`AMP_INTEGRATION_SKETCH.md`](./AMP_INTEGRATION_SKETCH.md)  
**External track:** [ant-intl/AMP#2](https://github.com/ant-intl/AMP/issues/2) (open; no certification claimed here).

## What maps, what does not

| Concept | AMP (upstream) | Agent-Rider (HOST) |
| --- | --- | --- |
| Live hop debit today | — | Base USDC via x402 + **XPay** facilitator default |
| Planned second rail | Alipay+ / mandate / Payment Token (when certified) | Dual-rail **beside** XPay — not a drop-in replacement |
| Agent identity | SD-JWT mandate chain (ES256); assurance L1–L3 | Rider JWT (ES256); clearance **L0–L4** |
| Board credits (AGC) | Not an AMP currency | Board-only; hop settle returns **410** for `credits:` |
| Signed credential | Mandate / Payment Token evidence | Rider JWT ≠ KYC claim |

**Do not equate** Rider clearance L0–L4 with AMP assurance L1–L3.  
**Do not** invent Ant / Alipay+ outreach status beyond what [AMP#2](https://github.com/ant-intl/AMP/issues/2) shows.

## Related Host docs

- Identity mint: [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md)
- Hop rails honesty: [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md)
