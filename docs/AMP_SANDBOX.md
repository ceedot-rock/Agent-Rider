# AMP sandbox recipe (Host eng)

**Status:** PARKED recipe + in-repo adapter **stub**. Does **not** enable AMP hop debit.  
**Live hop (unchanged):** Base USDC via **XPay** / x402 on `POST /api/settle`.  
**Flag:** `AMP_SETTLE_LIVE` — default **false**. Setting true does **not** enable AMP while only the stub exists (`amp_settle_not_live`).  
**Cash face:** https://www.slidphilabs.com/pcc (not a second Rider cash door). Tip/board stamp stays **43.72M**.

Related: [AMP_MILESTONE.md](./AMP_MILESTONE.md) · [AMP_INTEGRATION_SKETCH.md](./AMP_INTEGRATION_SKETCH.md) · [AMP_RIDER_MAP.md](./AMP_RIDER_MAP.md) · [PAYMENT_PATHS.md](./PAYMENT_PATHS.md).

## Goal

Stand up a **repeatable local AMP sample sandbox** (upstream `human_not_present` / `human_present` scenarios) **or** use the in-repo offline fixture, and record mandate / Payment Token field shapes against Rider JWT claims — **without** production secrets and **without** breaking live XPay.

## Path A — Upstream sample stack (Host eng machine)

Upstream: [ant-intl/AMP](https://github.com/ant-intl/AMP) · scenarios under `samples/python/scenarios/`.

```bash
# Host eng only — do not commit vendor .env, keys.json, or ar_ values into Agent-Rider
git clone https://github.com/ant-intl/AMP.git
cd AMP

# human_not_present → FLOW=human_not_present → AUTONOMOUS (L2+L3 agent chain)
./samples/python/scenarios/human_not_present/start.sh

# human_present → FLOW=human_present → IMMEDIATE (human-in-loop checkout)
./samples/python/scenarios/human_present/start.sh
```

Default ports (override if busy, e.g. `AGENT_PORT=9080 ./start.sh`):

| Service | Env | Default |
| --- | --- | --- |
| Shopping agent | `AGENT_PORT` | 8080 |
| Merchant | `MERCHANT_PORT` | 8081 |
| Credential provider | `CREDENTIALS_PROVIDER_PORT` | 8082 |
| Alipay+ network | `ALIPAYPLUS_NETWORK_PORT` | 8083 |
| Alipay+ mandate | `ALIPAYPLUS_MANDATE_PORT` | 8084 |
| Acquirer | `ACQUIRER_PORT` | 8085 |
| MPP | `MPP_PORT` | 8086 |
| Web frontend | `WEB_FRONTEND_PORT` | 8088 |

Open `http://localhost:8088`, run a sample checkout, then capture **field names only** from mandate session + Payment Token JSON (logs under `scenarios/*/ .logs/` — never paste secrets into PRs).

## Path B — In-repo offline fixture (CI / no upstream clone)

No Ant credentials, no USDC, no live AMP:

```bash
cd src
npm run selftest:amp                 # L1/L2/L3 + sd_hash shapes (amp-mandate-shape.mjs)
npm run selftest:amp-settle-adapter  # stub OFF by default; flag-on still 501 not_live
npm run selftest:settle              # XPay dry + credits: → 410
```

Fixtures live in `src/lib/amp-mandate-shape.mjs` (`buildOfflineFixtures()`). Shape only — **not** live settle.

## Field map — AMP shapes vs Rider JWT claims

Record gaps here; do **not** equate Rider clearance with AMP assurance.

| Concern | AMP (sample / fixture) | Rider JWT (Host) | Map? |
| --- | --- | --- | --- |
| Agent / subject id | L1 `sub`; L2/L3 `aud` / mandate roles | `agent_id` | Partial — different issuers; document binding plan before flip |
| Assurance / clearance | AMP L1–L3 (mandate layers) | Rider `level` L0–L4 | **No** — separate vocabularies |
| Scopes / intent | L2 SD claims `intent`, `mandate_info`, `token_info` | `scopes` | Partial — AMP intent ≠ Rider scopes string list |
| Session / nonce | L2/L3 `nonce`, `sd_hash` chain | `jti` | Related (replay) — different crypto |
| Key binding | L1/L2 `cnf.jwk` (ES256) | Rider JWKS ES256 | Alg matches; PKI / issuer differ |
| Payment evidence | Payment Token / checkout SD claims | x402 `X-PAYMENT` + SettleHop | Different rails until AMP adapter is proven |
| Board credits | Not an AMP currency | `key_id=credits:*` → **410** | Both rails must reject |

When capturing upstream tokens, fill a lab note with **field names only** and point gaps back to [AMP_MILESTONE.md](./AMP_MILESTONE.md) checklist.

## In-repo stub (honesty)

| Piece | Behavior |
| --- | --- |
| `src/lib/amp-settle-adapter.ts` | `attemptAmpSettle()` → always **501** `amp_settle_not_live`; `hop_default: "xpay"`; `live: false` |
| `POST /api/settle` | **Does not call** the AMP stub on the default path — XPay / x402 only |
| Env `AMP_SETTLE_LIVE` | Default false; true still stub-refuses until a later proven adapter PR |
| Credits firewall | Unchanged: `credits:` → **410** `reject.agc_removed` (see `selftest:settle`) |

Keep `AMP_SETTLE_LIVE=false` on Fly until the milestone checklist is green **and** a proven adapter replaces the stub.

## Do not

- Spend or store real `ar_` keys in sandbox fixtures / PRs / logs.
- Claim AMP settle is live.
- Route funded hops through AMP while XPay is the certified default.
- Add a second public cash CTA on Rider (cash stays `/pcc`).
- Invent Ant / Alipay+ pilot acceptance beyond [AMP#2](https://github.com/ant-intl/AMP/issues/2).
