# Status — Ticket 3: Studio→Rider citizen-receipt HTTP cutover

**Date stamp:** 2026-09-24 (America/New_York)  
**Branch:** `feat/cuni-citizen-receipt-http`  
**Tree:** `/workspace/Agent-Rider-cuni`  
**Base:** `origin/main` @ `0a0fd33` (PR #52 attestation merge)

## Done

| Item | Path / note |
| --- | --- |
| HTTP receive | `POST /api/v0/citizen-receipts` (+ `GET ?hash=`) |
| Persist / bind | `src/lib/cuni-citizen-receipt-store.ts` (memory + optional Supabase) |
| Contracts compat bind | `POST /api/v0/contracts` binds receipt → `contract_id` |
| Auth | `CUNI_STUDIO_INGEST_KEY` / merchant / api_key / optional open flag |
| Docs | `docs/CUNI_CITIZEN_GATE.md` honesty cutover |
| Coord | `docs/_CUNI_COORD_PASS_GATE.md` exact interface for CuNi |
| SQL | `supabase/cuni_citizen_receipts.sql` |
| Selftests | `selftest:cuni-citizen-gate` + `selftest:cuni-citizen-receipt-http` |

## Honesty

- Rider **receive** path: implemented on this branch.
- Rider **outbound** call to Studio: still **PARKED**.
- Do not claim live Studio→Rider on Fly until CuNi push + deploy is proven.
- Fund = settle / XPay — never PCC.

## Selftests

```bash
cd /workspace/Agent-Rider-cuni/src
npm run selftest:cuni-citizen-gate
npm run selftest:cuni-citizen-receipt-http
```

## Flags

```
CUNI_CITIZEN_RECEIPT_REQUIRED=false
CUNI_STUDIO_INGEST_KEY=
CUNI_CITIZEN_RECEIPT_INGEST_OPEN=false
```

## Ship

See `_SHIP_HANDOFF_CUNI_RECEIPT.md` if push is blocked.
