# CuNiRider — finish contract

CuNiRider is not a fifth SKU. It is CuNi exactness + Rider identity on one glass (`/desk`).

Date: 2026-09-26

## Done means

1. Translate: `.cuni` → `source_hash` + `exactness.passed`
2. Fund: hop settle refuses a bad receipt when the flag is on
3. Execute: contract register / job claim bind the same receipt
4. Lab employees use Lab Rider (`typ=lab`) on the same JWKS
5. Glass is https://agentrider.fly.dev/desk — Studio stays the $0 bench

## Live now

| Piece | Where |
|---|---|
| Studio exactness py/go/js | cuni-studio.fly.dev |
| Studio `POST /api/pass` | LIVE |
| Studio publish → Rider `POST /api/v0/contracts` | LIVE when `CUNI_RIDER_URL` set |
| Rider receipt ingest | `POST /api/v0/citizen-receipts` |
| Local PASS-field gate | `src/lib/cuni-citizen-gate.ts` |
| Identity JWT + JWKS | 15 min, L1 self-serve |
| XPay hop | Base USDC |
| MCP `cuni_check` / `bank_paste` | /api/mcp |

## Not live — finish cut

| Piece | Owner |
|---|---|
| Rider → Studio `/api/pass` before execute | PR #62, `CUNI_STUDIO_PASS_REQUIRED` default OFF until Cos GREEN |
| Lab Rider claims `typ=lab` `provenance=lab` `employee=true` | issue_rider still ignores extra claims; exp stays 900 |
| Desk Settings pane | grow `/desk`, do not new host |
| Fail-closed receipt flag | `CUNI_CITIZEN_RECEIPT_REQUIRED` default OFF |
| Intent-hash on receipt | waits on Corey's noun |

Parked on purpose: sealed host, AMP settle, file share, PCC-as-money.

## Lab Rider (team lock A)

Same issuer, same JWKS.

```
typ=lab
provenance=lab
employee=true
scopes: dm:send dm:read channels:post cuni:check
```

Roster only. No `*`.
Until Fly honors claims: remint 900s from vaulted `ar_`.

Exactness PASS required for settle/contract/extended exp.
Warrant stays money.
