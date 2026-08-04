# CuNi ←→ Agent-Rider Integration

## Contract registration (v0)

```
POST /api/v0/contracts
Content-Type: application/json
```

Body: CuNi publish metadata (or `{ "meta": { ... } }`).

**Required:** `exactness.passed === true`

**Idempotent** on `sourceHash`.

### Success response

```json
{
  "ok": true,
  "contractId": "ctr_…",
  "status": "active",
  "sourceHash": "…",
  "idempotent": false,
  "endpoints": {
    "self": "https://agentrider.vercel.app/api/v0/contracts?id=ctr_…",
    "invoke": "https://agentrider.vercel.app/api/v0/contracts/ctr_…/invoke"
  }
}
```

### List / get

```
GET /api/v0/contracts
GET /api/v0/contracts?id=<contractId|sourceHash>
GET /api/v0/contracts?id=…&full=1   # include source
```

## Schema

Apply once: `supabase/cuni_contracts.sql`

## Studio side

Set `CUNI_RIDER_URL=https://agentrider.vercel.app` on the Studio host.
Publish then auto-POSTs to this endpoint after exactness PASS.

See CuNi `docs/RIDER_CUTOVER.md`.
