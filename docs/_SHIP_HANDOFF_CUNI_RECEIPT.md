# Ship handoff — Ticket 3 citizen-receipt HTTP (push 403)

**Branch:** `feat/cuni-citizen-receipt-http`  
**Feature commit:** `c05f5924effbd2d03cec6b04d8423551b6503e39` (`c05f592`)  
**Local tree:** `/workspace/Agent-Rider-cuni`  
**Base:** `origin/main` @ `9b688aa` (PR #53 AMP merge)  
**Tip:** run `git -C /workspace/Agent-Rider-cuni rev-parse HEAD` (includes this handoff commit)

## Why no PR

`git push -u origin feat/cuni-citizen-receipt-http` → **403**  
`Permission to ceedot-rock/Agent-Rider.git denied to ceedot-rock.`

Host/operator: push this branch from a credential that can write the repo, then:

```bash
cd /workspace/Agent-Rider-cuni
git push -u origin feat/cuni-citizen-receipt-http
gh pr create --base main --head feat/cuni-citizen-receipt-http \
  --title "feat(cuni): Studio→Rider citizen-receipt HTTP receive cutover" \
  --body "## Summary
Ticket 3 — Studio→Rider citizen-receipt HTTP cutover (receive path).
- POST /api/v0/citizen-receipts (+ GET by hash) with ingest-key / merchant / api_key auth
- Persist/bind by source_hash (memory + optional cuni_citizen_receipts SQL)
- Contracts register binds receipt when present (Studio compat)
- Docs honest: receive wired; Rider→Studio outbound still PARKED
- Fund = settle/XPay (never PCC)

## Selftests
cd src && npm run selftest:cuni-citizen-gate && npm run selftest:cuni-citizen-receipt-http

## Flags
CUNI_CITIZEN_RECEIPT_REQUIRED (body strict, default off)
CUNI_STUDIO_INGEST_KEY (preferred Studio shared secret)
CUNI_CITIZEN_RECEIPT_INGEST_OPEN (temporary open, default off)

## Coord
docs/_CUNI_COORD_PASS_GATE.md — exact interface for CuNi Code Unity."
```

## Files

- `src/app/api/v0/citizen-receipts/route.ts`
- `src/lib/cuni-citizen-receipt-store.ts`
- `src/lib/cuni-citizen-receipt-http.selftest.mjs`
- `src/app/api/v0/contracts/route.ts` (bind on register)
- `supabase/cuni_citizen_receipts.sql`
- Docs: `CUNI_CITIZEN_GATE.md`, `_CUNI_COORD_PASS_GATE.md`, `_STATUS_CUNI_RECEIPT.md`

## Do not

- Force-push main
- Claim Rider calls Studio / live Studio gate from Rider alone
- Commit secrets / Discord blasts
- Touch `/workspace/Agent-Rider-qs` or `/workspace/Agent-Rider-track-a`
