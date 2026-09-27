# Toll 1 + Toll 2 — behind feature flags

**Status:** implemented behind flags **OFF** (CoS GREEN 2026-09-27).  
**Do not** put public pricing on `llms.txt` until Docs/Press + a separate CoS green.  
**Do not** silent-meter existing free routes. **No x402 fork. No second Warrant.**

## Flags (default OFF)

| Flag | Route | When OFF | When ON |
| --- | --- | --- | --- |
| `TOLL1_METER_LIVE` | `POST /api/toll/v1/verify` | **503** `{ error: "toll1_meter_off", … }` — no charge | Stripe meter + JWT verify (same crypto as `/api/rider/verify`) |
| `TOLL2_LOOKUP_LIVE` | `POST /api/toll/v2/lookup` | **503** `{ error: "toll2_lookup_off", … }` — no charge | Stripe meter @ **2¢/request**, L1+ verified matches |
| `TOLL2_PROMOTE_LIVE` | `POST /api/toll/v2/promote` | **503** `{ error: "toll2_promote_off", … }` | Stub still refuses full Checkout until price wired (**501** if flag flipped early) |

Treat live as env `1` or `true` only. Unset / `0` / anything else = OFF.

## Still free forever (this PR)

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
- **Stripe env (stubs):**
  - `STRIPE_RIDER_VERIFY_METER_NAME` — Billing Meter event name (dashboard-created)
  - `STRIPE_RIDER_VERIFY_METERED_PRICE_ID` — optional docs stub for the metered Price id
- Reuses `verifyRider()` from `src/lib/rider.ts` — same ES256 / issuer checks as free verify.

## Toll 2 — capabilities + metered lookup

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

### Promote (stub)

- `POST /api/toll/v2/promote` — intended **$9/mo per capability**
- Env stub: `STRIPE_CAPABILITY_PROMOTE_PRICE_ID`
- Flag OFF → 503; flag ON without Checkout → 501 honesty refuse

## Honesty

- Signed rider ≠ KYC
- Capability attestation ≠ Warrant (delegated authority is a different lane)
- No public llms pricing lines in this PR
- Flags stay OFF until Stripe meters/prices exist and smoke passes

## Ops checklist before flipping flags

1. Create Stripe Billing Meters + metered Prices; set `STRIPE_*_METER_NAME` (+ price ids)
2. Apply `supabase/capabilities.sql`
3. Smoke: free `/api/rider/verify` still free; flag-off toll routes 503; flag-on test clock meter event
4. Separate CoS + Docs/Press before any public pricing copy
