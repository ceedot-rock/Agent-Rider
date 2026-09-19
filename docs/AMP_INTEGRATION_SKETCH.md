# AMP integration sketch (engineering)

**Audience:** Host eng. Not a product claim that AMP settle is live.  
**Companion:** [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · [`AMP_RIDER_MAP.md`](./AMP_RIDER_MAP.md) · [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md)  
**Upstream samples:** [ant-intl/AMP](https://github.com/ant-intl/AMP) (`samples/python/scenarios/*`)  
**Track only:** [ant-intl/AMP#2](https://github.com/ant-intl/AMP/issues/2) — do not invent Ant replies or pilot acceptance.

## Goal

When certified, run AMP (mandate / Payment Token path) as a **second hop rail beside XPay**, sharing the same rider gate on `POST /api/settle`. XPay stays the default until an explicit flip checklist passes.

## Sandbox blockers (next eng work)

These are Host-side engineering gates — not marketing milestones.

1. **No AMP settle adapter in-tree** — `POST /api/settle` today routes hop debit through x402 + XPay (or optional CDP). There is no AMP Payment Token / mandate verify-settle branch yet.
2. **Local AMP sample sandbox** — run upstream `human_not_present` / `human_present` scenario scripts; capture mandate + Payment Token shapes against Rider JWT claims. Blocker until a repeatable sandbox recipe exists in this repo (or a linked lab note) without production secrets.
3. **Identity mapping without level confusion** — document how Rider `agent_id` / JWKS ES256 maps onto AMP SD-JWT mandate roles; keep Rider L0–L4 and AMP assurance L1–L3 as separate vocabularies in code and discovery copy.
4. **Credits firewall** — AMP must reject board `credits:` the same way XPay hop does (**410**). Extend SettleHop smoke when an AMP stub exists; until then credits honesty remains XPay-only in CI.
5. **Discovery honesty lock** — public manifests must keep saying XPay default / AMP when certified until flip. No soft “AMP live” or GC marketing on hop.
6. **Flip gate** — do not enable AMP as a selectable live settle rail until [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) checklist is green.

## Out of scope for this sketch

- Filing or claiming Ant / Alipay+ partner outreach beyond AMP#2.
- Spending or storing real `ar_` keys in docs, PRs, or sandbox fixtures.
- Treating board AGC as hop or AMP currency.
- File sharing (planned elsewhere; not live).

## Suggested eng sequence

1. Sandbox: clone/run AMP samples; note mandate session + token fields needed at settle.
2. Sketch adapter interface beside XPay facilitator client (feature-flagged off).
3. Dry verify path + smoke: AMP stub refuses `credits:`; missing AMP config does not break XPay.
   Offline shape fixture already in CI: `npm run selftest:amp` (L1/L2/L3 + sd_hash; **not** live settle) — see [`AMP_MILESTONE.md`](./AMP_MILESTONE.md).
4. Update discovery + `PAYMENT_PATHS.md` only when certify + flip checklist passes.
