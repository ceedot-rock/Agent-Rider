# CuNi citizen receipt gate — Translate → Fund → Execute

**Date stamp:** 2026-09-19 (America/New_York)  
**Status:** **Partial** — local Rider shape gate is wired; **live CuNi Studio → Rider citizen-receipt push is PARKED** (this code does **not** call Studio).  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · no `ar_` secrets in docs/PRs/logs · **Fund path = Rider settle / XPay hop (never PCC as the money layer)**.

Related: [`CUNI_INTEGRATION.md`](./CUNI_INTEGRATION.md) · [`HOST_ATTESTATION.md`](./HOST_ATTESTATION.md) · [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md)

---

## What this is

CuNi **Translate** (check / bank) produces a **citizen receipt**. Rider **Fund** (hop settle via XPay) and **Execute** (contract register / job accept) should refuse when that receipt does not PASS.

PASS fields (required when a receipt object is present, or always when strict env is on):

| Field | Rule |
| --- | --- |
| `source_hash` | Non-empty string (`sourceHash` accepted as alias) |
| `exactness.passed` | Must be `=== true` |

---

## Modes

| Mode | Env | Behavior |
| --- | --- | --- |
| **Validate-when-present** (default) | `CUNI_CITIZEN_RECEIPT_REQUIRED` unset / not `true` | If `citizen_receipt` (or alias) is on the request, require PASS fields; if absent, continue. |
| **Strict / fail-closed** | `CUNI_CITIZEN_RECEIPT_REQUIRED=true` | Missing receipt → **400** `citizen_receipt_required`. Invalid shape → **400** `citizen_receipt_invalid`. |

Default is **off** (strict mode not enabled).

---

## Hooked paths

| Path | Role in T→F→E |
| --- | --- |
| `POST /api/v0/contracts` | Execute — register verified CuNi publish (publish meta may serve as receipt-equivalent) |
| `POST /api/settle` | Fund — Rider **XPay** hop settle (not PCC) |
| `POST /api/tasks/claim` | Execute — job accept |
| `POST /api/first-job` `action=claim` | Execute — practice job accept |

Module: `src/lib/cuni-citizen-gate.ts`. Selftest: `npm run selftest:cuni-citizen-gate` (from `src/`).

---

## Request shape

```json
{
  "citizen_receipt": {
    "source_hash": "sha256-hex-of-source",
    "exactness": { "passed": true }
  }
}
```

Aliases for the envelope: `citizenReceipt`, `receipt`.  
Hash alias: `sourceHash`.  
Contract register may also use top-level / `meta` publish fields (`sourceHash` + `exactness`) as the receipt-equivalent — same PASS rules. Existing `registerCuniContract` still refuses `exactness.passed !== true`.

Error bodies include `studio: "not_called"` so clients do not mistake a local refuse for a live Studio round-trip.

---

## Honesty — Studio wire

| Claim | Truth today |
| --- | --- |
| Local PASS-field gate on Rider | **Wired** (this PR) |
| Rider calls CuNi Studio to mint/verify citizen receipts | **No** — PARKED / not implemented |
| Soft “live Studio citizen gate” copy | **Forbidden** until Studio HTTP is actually called |

When Studio cutover lands, update this doc in the **same** PR that adds the client call.

---

## Fund path reminder

Hop **Fund** is **Rider `POST /api/settle` → XPay** (Base USDC / x402). Do **not** describe PCC as the money layer. Board credits remain non-hop (**410**). AMP dual-rail stays tracked in [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) until certified.

---

## Env

```
# Optional strict citizen receipt gate. Default off (validate-when-present only).
CUNI_CITIZEN_RECEIPT_REQUIRED=false
```

Never put `ar_` values, Studio secrets, or JWTs in docs or logs.
