# AMP sandbox recipe (Host eng)

**Status:** PARKED recipe + in-repo adapter **stub**. Does **not** enable AMP hop debit.  
**Live hop (unchanged):** Base USDC via **XPay** / x402 on `POST /api/settle`.  
**Flag:** `AMP_SETTLE_LIVE` — default **false**. Setting true does **not** enable AMP while only the stub exists (`amp_settle_not_live`).  
**Cash face:** https://www.slidphilabs.com/pcc (not a second Rider cash door). Tip/board stamp stays **43.72M**.

Related: [AMP_MILESTONE.md](./AMP_MILESTONE.md) · [AMP_INTEGRATION_SKETCH.md](./AMP_INTEGRATION_SKETCH.md) · [PAYMENT_PATHS.md](./PAYMENT_PATHS.md).

## Goal

Stand up a **repeatable local AMP sample sandbox** (upstream `human_not_present` / `human_present` scenarios) and record mandate / Payment Token field shapes against Rider JWT claims — **without** production secrets and **without** breaking live XPay.

## Recipe (offline / sample-only)

1. Clone upstream AMP sample scenarios (Host eng machine; do not commit vendor secrets).
2. Run `human_not_present` and `human_present` scripts against the **sample** facilitator / sandbox — not production payTo.
3. Capture mandate session + Payment Token JSON shapes (field names only in this repo).
4. Diff those fields against Rider JWT claims (`agent_id`, `level`, `scopes`, `jti`) — document gaps in AMP_MILESTONE checklist.
5. Keep `AMP_SETTLE_LIVE=false` on Fly until milestone checklist is green **and** a proven adapter replaces `src/lib/amp-settle-adapter.ts`.

## In-repo stub

| Piece | Behavior |
| --- | --- |
| `src/lib/amp-settle-adapter.ts` | `attemptAmpSettle()` → always **501** `amp_settle_not_live`; `hop_default: "xpay"` |
| `POST /api/settle` | **Does not call** the AMP stub on the default path — XPay / x402 only |
| Env `AMP_SETTLE_LIVE` | Default false; true still stub-refuses until a later PR |

Selftest: `cd src && npm run selftest:amp-settle-adapter`.

## Do not

- Spend or store real `ar_` keys in sandbox fixtures / PRs / logs.
- Claim AMP settle is live.
- Route funded hops through AMP while XPay is the certified default.
- Add a second public cash CTA on Rider (cash stays `/pcc`).
