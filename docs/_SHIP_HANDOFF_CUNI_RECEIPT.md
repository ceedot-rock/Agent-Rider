# Ship handoff — Ticket 3 citizen-receipt HTTP receive

**Branch:** `feat/cuni-citizen-receipt-http`  
**Base:** `origin/main` @ `b766b40` (PR #56 AMP honesty merge)  
**Supersedes:** Agent-Rider PR #55 (docs-only Studio push ACK) — this PR adds dedicated ingest + bind.

## Summary
- `POST /api/v0/citizen-receipts` (+ GET by hash) with ingest-key / merchant / api_key auth
- Persist/bind by `source_hash` (memory + optional `cuni_citizen_receipts` SQL)
- `POST /api/v0/contracts` binds receipt when PASS + ACKs `citizen_receipt_accepted` / `studio: called` (CuNi #23 compat)
- Honesty: receive wired; Rider→Studio outbound still **PARKED**
- Fund = settle / XPay (never PCC) · tip stamp 43.72M · cash `/pcc`

## Selftests
```bash
cd src && npm run selftest:cuni-citizen-gate && npm run selftest:cuni-citizen-receipt-http
```

## Flags
- `CUNI_CITIZEN_RECEIPT_REQUIRED` (body strict, default off)
- `CUNI_STUDIO_INGEST_KEY` (preferred Studio shared secret)
- `CUNI_CITIZEN_RECEIPT_INGEST_OPEN` (temporary open, default off)

## Coord
`docs/_CUNI_COORD_PASS_GATE.md` — exact interface for CuNi Code Unity.
Paired Studio push: ceedot-rock/cuni#23 (contracts path still accepted).
