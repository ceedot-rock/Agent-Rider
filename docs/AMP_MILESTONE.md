# AMP milestone — dual-rail status

**Date stamp:** 2026-09-19 (America/New_York)  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · file sharing planned not live · no GC marketing · no `ar_` secrets in docs/PRs.

## Dual-rail status

| Rail | Settle status | Notes |
| --- | --- | --- |
| **XPay** (x402 / Base USDC) | **LIVE default** | Facilitator `https://facilitator.xpay.sh`. Env + honesty: [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md). |
| **AMP** (Alipay+ / mandate / Payment Token) | **NOT live settle** | Planned dual-rail **beside** XPay when certified — not a drop-in replacement, not board credits. |

**External tracking only:** [ant-intl/AMP#2](https://github.com/ant-intl/AMP/issues/2) (ecosystem / pilot ask; open as of this stamp). Do not invent Ant outreach outcomes here.

**Identity reminder:** Rider clearance L0–L4 ≠ AMP assurance L1–L3. Signed rider JWT ≠ KYC-verified.

## Next eng milestones

Pulled from [`AMP_INTEGRATION_SKETCH.md`](./AMP_INTEGRATION_SKETCH.md) (sandbox blockers; Host eng only):

1. Stand up a repeatable **AMP sample sandbox** (upstream scenarios) and record mandate / Payment Token fields needed at hop.
2. Design a **feature-flagged AMP adapter** beside the XPay facilitator client — off by default; missing AMP config must not break XPay.
3. Keep the **credits firewall**: AMP path must reject `credits:` (**410**) the same as XPay hop; extend SettleHop smoke when a stub exists.
4. Keep **discovery honesty**: XPay default / AMP when certified until flip — no soft “AMP live,” no GC-on-hop copy.
5. **Map identities carefully** (Rider JWKS ES256 ↔ AMP SD-JWT roles) without conflating clearance levels.
6. **Offline CI fixture** — `npm run selftest:amp` (`src/lib/amp-mandate.selftest.mjs`) documents public AMP mandate_chain SD-JWT L1/L2/L3 shape expectations + sd_hash binding. Shape only; **not** live AMP settle.

Map of concepts: [`AMP_RIDER_MAP.md`](./AMP_RIDER_MAP.md).

## Checklist — when AMP can be flipped on

Do **not** advertise AMP as a live hop debit until all of the following are true:

- [ ] Certification / pilot acceptance is recorded against [AMP#2](https://github.com/ant-intl/AMP/issues/2) (or a successor Host decision note) — not assumed.
- [ ] AMP sandbox recipe is reproducible without production secrets.
- [ ] AMP settle adapter is behind an explicit env/flag; default remain XPay.
- [ ] Smoke covers: XPay still green · AMP dry path · `credits:` → 410 on both rails · unauth settle → 401 `missing_rider`.
- [ ] [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md), discovery manifests (`agent.json`, `llms.txt`, `agents.json`), and this milestone are updated in the **same** change that flips the flag.
- [ ] No `ar_` values, signing keys, or Ant partner credentials appear in docs or PRs.
- [ ] Copy still states signed ≠ KYC; file sharing remains planned/not live until shipped separately.

Until then: operators settle hops with XPay; AMP stays tracked, not live.

## Related security

Host cryptographic attestation + sealed runtime (PARKED until proven — not live Nitro): [`HOST_ATTESTATION.md`](./HOST_ATTESTATION.md). Operator key vault / mint: [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md). CuNi citizen receipt gate (T→F→E; Studio wire PARKED): [`CUNI_CITIZEN_GATE.md`](./CUNI_CITIZEN_GATE.md).
