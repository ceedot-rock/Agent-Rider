# CuNi citizen receipt gate — Translate → Fund → Execute

**Date stamp:** 2026-09-24 (America/New_York)  
**Status:** **Wired** — local Rider shape gate is live; **Studio → Rider citizen-receipt HTTP push** is implemented on CuNi Studio publish (`POST /api/publish` → this host `POST /api/v0/contracts` with `citizen_receipt`) when Studio has `CUNI_RIDER_URL` set. Live Fly reflects that after the paired CuNi PR deploys.  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · no `ar_` secrets in docs/PRs/logs · **Fund path = Rider settle / XPay hop (never PCC as the money layer)**.

Related: [`CUNI_INTEGRATION.md`](./CUNI_INTEGRATION.md) · [`HOST_ATTESTATION.md`](./HOST_ATTESTATION.md) · [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md) · CuNi [`PASS_GATE.md`](https://github.com/ceedot-rock/cuni/blob/master/docs/PASS_GATE.md)

---

## What this is

CuNi **Translate** (check / bank / Studio pass) produces a **citizen receipt**. Rider **Fund** (hop settle via XPay) and **Execute** (contract register / job accept) should refuse when that receipt does not PASS.

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
| `POST /api/v0/contracts` | Execute — register verified CuNi publish (**Studio push target** for `citizen_receipt`) |
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

### Studio publish push body (CuNi → Rider)

When CuNi Studio publish PASSes and `CUNI_RIDER_URL` points here:

```json
{
  "meta": { "source": "...", "sourceHash": "<sha256>", "exactness": { "passed": true } },
  "citizen_receipt": {
    "source_hash": "<sha256>",
    "exactness": { "passed": true }
  },
  "studio": "called"
}
```

Header: `X-Cuni-Studio: called` (optional signal).

### Rider-callable Studio verify (optional second door)

Rider Execute may call Studio **before** a sealed ride:

`POST https://cuni-studio.fly.dev/api/pass` with `{ "source": "..." }`  
→ PASS returns `citizen_receipt` + `studio: "called"` · REFUSE returns 400 with `studio: "called"`.

Local Rider gate refuses still include `studio: "not_called"` so clients do not mistake a **local** shape refuse for a Studio round-trip.

---

## Honesty — Studio wire

| Claim | Truth after paired CuNi + this docs PR |
| --- | --- |
| Local PASS-field gate on Rider | **Wired** |
| Studio → Rider citizen-receipt HTTP push on publish | **Implemented** (CuNi `rider_client.register_remote` → `POST /api/v0/contracts`) — live after Studio deploy |
| Rider calls Studio `/api/pass` automatically on every settle | **No** — optional pre-execute; local gate does not HTTP-call Studio |
| Soft “live Studio citizen gate” without an HTTP path | **Forbidden** |

Fund path reminder: hop **Fund** is **Rider `POST /api/settle` → XPay**. Do **not** describe PCC as the money layer.

---

## Env

```
# Optional strict citizen receipt gate. Default off (validate-when-present only).
CUNI_CITIZEN_RECEIPT_REQUIRED=false
```

Never put `ar_` values, Studio secrets, or JWTs in docs or logs.
