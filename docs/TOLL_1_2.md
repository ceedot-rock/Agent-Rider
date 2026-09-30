# Toll 1 + Toll 2 — identity meter, lookup, promote

**Status (2026-09-29):** Code wired on `main`. Live Fly (`agentrider.fly.dev`) has the Toll 1 / Toll 2 flags **ON** with Stripe meters + the promote Checkout price set. Defaults in fresh env stay **OFF** until you flip them.

**Do not** put public pricing on `llms.txt` until Docs/Press + a separate CoS green.
**Do not** silent-meter existing free routes. **No x402 fork. No second Warrant.**

## Flags (default OFF in code; ON on live Fly today)

| Flag | Route | When OFF | When ON |
| --- | --- | --- | --- |
| `TOLL1_METER_LIVE` | `POST /api/toll/v1/verify` | **503** `{ error: "toll1_meter_off", … }` — no charge | Stripe meter + JWT verify (same crypto as `/api/rider/verify`) |
| `TOLL2_LOOKUP_LIVE` | `POST /api/toll/v2/lookup` | **503** `{ error: "toll2_lookup_off", … }` — no charge | Stripe meter @ **2¢/request**, L1+ verified matches |
| `TOLL2_PROMOTE_LIVE` | `POST /api/toll/v2/promote` | **503** `{ error: "toll2_promote_off", … }` | Stripe Checkout **$9/mo** per capability (`STRIPE_CAPABILITY_PROMOTE_PRICE_ID`). Returns `{ live:true, url, price_usd_mo:9, capability_id }`. Missing price id → **500** `toll2_promote_price_missing` |

Treat live as env `1` or `true` only. Unset / `0` / anything else = OFF.

## Still free forever

| Path | Notes |
| --- | --- |
| `GET /.well-known/jwks.json` | Peer local verify — always free |
| `POST /api/rider/verify` | Convenience verify — **not** silently metered |
| `POST /api/capabilities` | Upsert (self-only v0) |
| `GET /api/capabilities/{id}` | Raw read (L0 allowed; shows evidence level) |
| `GET /api/discovery` | Not metered |
| `GET /api/registry` | Not metered |

## Toll 1 — identity verify meter

- **Product route:** `POST /api/toll/v1/verify`
- **Body:** `{ "rider": "<JWT>" }` (or `X-Agent-Rider`)
- **Billing auth:** `Authorization: Bearer ar_…` **or** `X-Merchant-Key` — **caller pays**, not the subject agent
- **Price when live:** $0.005 / verification after free tier
- **Free tier:** **100 / calendar month** per payer key (`TOLL1_VERIFY_FREE_CALLS_PER_MONTH`, default 100)
- **Stripe env:**
  - `STRIPE_RIDER_VERIFY_METER_NAME` — Billing Meter event name (dashboard-created)
  - `STRIPE_RIDER_VERIFY_METERED_PRICE_ID` — optional metered Price id
- Reuses `verifyRider()` from `src/lib/rider.ts` — same ES256 / issuer checks as free verify.

## Toll 2 — capabilities + metered lookup + promote

### Schema

- JSON Schema: `schemas/capability.schema.json`
- SQL: `supabase/capabilities.sql` (pointer note in `supabase/schema.sql`)
- Evidence levels: `L0_self` | `L1_receipt` | `L2_exactness` | `L3_attest`
- **L3 / `host_attest`:** schema-legal, **PARKED** until host attestation is LIVE — honesty sets `live:false` + parked note. Do not claim LIVE.

### Free routes

- `POST /api/capabilities` — upsert; **self-only** (`agent_id` must match caller)
- `GET /api/capabilities/{id}` — free raw read

### Metered lookup

- `POST /api/toll/v2/lookup`
- Body: `{ "query": "…", "tags": ["…"], "min_evidence": "L1_receipt", "limit": 10 }`
- **$0.02 per request** (not per row)
- Paid **verified** badge: **L1+** (`L1_receipt`, `L2_exactness`; `L3_attest` only meaningful when attest LIVE — for now schema allows L3 but documents PARKED)
- Ranking v0: `0.5 * normalize(trust_score) + 0.3 * evidence_weight + 0.2 * promoted_boost`
- Stripe env: `STRIPE_CAPABILITY_LOOKUP_METER_NAME`, optional `STRIPE_CAPABILITY_LOOKUP_METERED_PRICE_ID`

### Promote (Checkout live)

- `POST /api/toll/v2/promote` — **$9/mo per capability**
- Body: `{ "capability_id": "cap_…", "email": "optional@example.com" }`
- Billing auth: `Authorization: Bearer ar_…` **or** `X-Merchant-Key`
- Env: `STRIPE_CAPABILITY_PROMOTE_PRICE_ID` (live Fly: Deployed; same $9/mo price as tollkeeper `2_promote`)
- Flag OFF → 503 `toll2_promote_off`
- Flag ON + price set → **200** `{ live:true, url:<Stripe Checkout>, price_usd_mo:9, capability_id }` (`cs_live_` = live-mode session)
- Flag ON + price missing → **500** `toll2_promote_price_missing`
- After payment: Stripe webhook `checkout.session.completed` flips capability `placement` (`promoted` / `promoted_until`) via `setCapabilityPromotion`

## Honesty

- Signed rider ≠ KYC
- Capability attestation ≠ Warrant (delegated authority is a different lane)
- No public llms pricing lines until Docs/Press + CoS green
- Promote Checkout creates a real live Stripe session when flags + price are on — treat it as money, not a mock
- Toll 5 exactness still uses the stub oracle (`result:"refuse"` for empty probe claims) until CuNi plugs in — separate from Toll 1/2

## Ops checklist (fresh env / new deploy)

1. Create Stripe Billing Meters + metered Prices; set `STRIPE_*_METER_NAME` (+ price ids)
2. Set `STRIPE_CAPABILITY_PROMOTE_PRICE_ID` to the $9/mo recurring price before flipping `TOLL2_PROMOTE_LIVE`
3. Apply `supabase/capabilities.sql`
4. Smoke: free `/api/rider/verify` still free; flag-off toll routes 503; flag-on promote returns Checkout URL; webhook flips placement after paid session
5. Separate CoS + Docs/Press before any public pricing copy
