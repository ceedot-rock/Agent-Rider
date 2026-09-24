# AMP integration sketch (engineering)

**Audience:** Host eng. Not a product claim that AMP settle is live.  
**Companion:** [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · [`AMP_RIDER_MAP.md`](./AMP_RIDER_MAP.md) · [`AMP_SANDBOX.md`](./AMP_SANDBOX.md) · [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md)  
**Upstream samples:** [ant-intl/AMP](https://github.com/ant-intl/AMP) (`samples/python/scenarios/human_not_present`, `human_present`)  
**Track only:** [ant-intl/AMP#2](https://github.com/ant-intl/AMP/issues/2) — do not invent Ant replies or pilot acceptance.

## Goal

When certified, run AMP (mandate / Payment Token path) as a **second hop rail beside XPay**, sharing the same rider gate on `POST /api/settle`. XPay stays the default until an explicit flip checklist passes.

## Sandbox blockers (next eng work)

These are Host-side engineering gates — not marketing milestones.

| # | Blocker | Status (honesty) |
| --- | --- | --- |
| 1 | **AMP settle adapter** | **Stub in-tree** (`src/lib/amp-settle-adapter.ts`), flag `AMP_SETTLE_LIVE` **OFF by default**. Always fail-closed **501** `amp_settle_not_live`. `POST /api/settle` does **not** call it — hop debit stays x402 + XPay. |
| 2 | **Local AMP sample sandbox** | **Recipe landed:** [`AMP_SANDBOX.md`](./AMP_SANDBOX.md) (upstream start.sh + in-repo offline fixture). Capture mandate / Payment Token field names vs Rider JWT claims without production secrets. |
| 3 | **Identity mapping without level confusion** | Document how Rider `agent_id` / JWKS ES256 maps onto AMP SD-JWT mandate roles; keep Rider L0–L4 and AMP assurance L1–L3 as separate vocabularies. Field map draft in AMP_SANDBOX. |
| 4 | **Credits firewall** | AMP stub must never spend `credits:`. Live settle still rejects `credits:` with **410** (`selftest:settle`). When a real AMP branch lands, extend smoke so AMP dry path also returns 410 for credits. |
| 5 | **Discovery honesty lock** | Public manifests must keep saying XPay default / AMP when certified until flip. No soft “AMP live” or GC marketing on hop. |
| 6 | **Flip gate** | Do not enable AMP as a selectable live settle rail until [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) checklist is green **and** a proven adapter replaces the stub. |

## Out of scope for this sketch

- Filing or claiming Ant / Alipay+ partner outreach beyond AMP#2.
- Spending or storing real `ar_` keys in docs, PRs, or sandbox fixtures.
- Treating board AGC as hop or AMP currency.
- File sharing (planned elsewhere; not live).

## Suggested eng sequence

1. Sandbox: follow [`AMP_SANDBOX.md`](./AMP_SANDBOX.md) (upstream samples **or** offline fixture); note mandate session + token fields needed at settle.
2. Adapter stub beside XPay facilitator client — **done** (feature-flagged off; fail-closed).
3. Dry verify path + smoke: stub refuses live settle; `credits:` → 410; missing AMP flag does not break XPay.  
   CI: `npm run selftest:amp` · `npm run selftest:amp-settle-adapter` · `npm run selftest:settle`.
4. Update discovery + `PAYMENT_PATHS.md` only when certify + flip checklist passes.
