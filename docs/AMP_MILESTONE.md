# AMP milestone — dual-rail status

**Date stamp:** 2026-09-19 (America/New_York)  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · file sharing planned not live · no GC marketing · no `ar_` secrets in docs/PRs.

## Dual-rail status

| Rail | Settle status | Notes |
| --- | --- | --- |
| **XPay** (x402 / Base USDC) | **LIVE default** | Facilitator `https://facilitator.xpay.sh`. Env + honesty: [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md). |
| **AMP** (Alipay+ / mandate / Payment Token) | **NOT live settle** | Stub adapter + sandbox recipe in-tree ([`AMP_SANDBOX.md`](./AMP_SANDBOX.md)); flag `AMP_SETTLE_LIVE` **OFF**. Dual-rail **beside** XPay only when certified — not board credits. |

**External tracking only:** [ant-intl/AMP#2](https://github.com/ant-intl/AMP/issues/2) (ecosystem / pilot ask; open as of this stamp). Do not invent Ant outreach outcomes here.

**Identity reminder:** Rider clearance L0–L4 ≠ AMP assurance L1–L3. Signed rider JWT ≠ KYC-verified.

## Next eng milestones

Pulled from [`AMP_INTEGRATION_SKETCH.md`](./AMP_INTEGRATION_SKETCH.md) (sandbox blockers; Host eng only):

1. ~~Stand up a repeatable **AMP sample sandbox**~~ — **done (recipe):** [`AMP_SANDBOX.md`](./AMP_SANDBOX.md) (upstream `human_not_present` / `human_present` + offline fixture). Still capture field gaps in lab notes.
2. ~~Feature-flagged AMP adapter stub~~ — **done (OFF):** `src/lib/amp-settle-adapter.ts` · env `AMP_SETTLE_LIVE` default false · always **501** `amp_settle_not_live`. Settle route does not call it.
3. Keep the **credits firewall**: `credits:` → **410** on live settle (`selftest:settle`); AMP stub must never spend credits. Extend smoke when a real AMP branch lands.
4. Keep **discovery honesty**: XPay default / AMP when certified until flip — no soft “AMP live,” no GC-on-hop copy.
5. **Map identities carefully** (Rider JWKS ES256 ↔ AMP SD-JWT roles) without conflating clearance levels — field map draft in AMP_SANDBOX.
6. **Offline CI fixture** — `npm run selftest:amp` + `npm run selftest:amp-settle-adapter`. Shape + stub honesty only; **not** live AMP settle.

Map of concepts: [`AMP_RIDER_MAP.md`](./AMP_RIDER_MAP.md).

## Checklist — when AMP can be flipped on

Do **not** advertise AMP as a live hop debit until all of the following are true:

- [ ] Certification / pilot acceptance is recorded against [AMP#2](https://github.com/ant-intl/AMP/issues/2) (or a successor Host decision note) — not assumed.
- [x] AMP sandbox recipe is reproducible without production secrets ([`AMP_SANDBOX.md`](./AMP_SANDBOX.md)).
- [x] AMP settle adapter stub is behind `AMP_SETTLE_LIVE`; default remains XPay (stub still refuse-closed even if flag true).
- [ ] Smoke covers: XPay still green · AMP dry path · `credits:` → 410 on both rails · unauth settle → 401 `missing_rider`. (XPay + credits 410 + stub dry: green today; real AMP branch still TODO.)
- [ ] [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md), discovery manifests (`agent.json`, `llms.txt`, `agents.json`), and this milestone are updated in the **same** change that flips the flag.
- [ ] No `ar_` values, signing keys, or Ant partner credentials appear in docs or PRs.
- [ ] Copy still states signed ≠ KYC; file sharing remains planned/not live until shipped separately.

Until then: operators settle hops with XPay; AMP stays tracked, not live.

## Related security

Host cryptographic attestation + sealed runtime (PARKED until proven — not live Nitro): [`HOST_ATTESTATION.md`](./HOST_ATTESTATION.md). Operator key vault / mint: [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md). CuNi citizen receipt gate (T→F→E; Studio wire PARKED): [`CUNI_CITIZEN_GATE.md`](./CUNI_CITIZEN_GATE.md).
