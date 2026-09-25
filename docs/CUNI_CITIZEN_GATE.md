# CuNi citizen receipt gate — Translate → Fund → Execute

**Date stamp:** 2026-09-24 (America/New_York)  
**Status:** **Partial cutover** — local Rider shape gate **wired**; Rider **HTTP receive** for Studio citizen receipts **wired** (`POST /api/v0/citizen-receipts`); Rider → Studio Execute verify (`POST /api/pass`) **WIRED (env-gated)** — default **off** (`CUNI_STUDIO_PASS_REQUIRED` unset/false). Do **not** claim soft “always live” Studio round-trips from Rider; enable only after Cos GREEN + Fly env. Live Studio→Rider push depends on CuNi `CUNI_RIDER_URL` + Studio deploy.  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · no `ar_` secrets in docs/PRs/logs · **Fund path = Rider settle / XPay hop (never PCC as the money layer)** · **PCC = lossless compressor only (never fund/paywall)**.

Related: [`CUNI_INTEGRATION.md`](./CUNI_INTEGRATION.md) · [`HOST_ATTESTATION.md`](./HOST_ATTESTATION.md) · [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) · [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md) · Coord: [`_CUNI_COORD_PASS_GATE.md`](./_CUNI_COORD_PASS_GATE.md)

---

## What this is

CuNi **Translate** (check / bank) produces a **citizen receipt**. Rider **Fund** (hop settle via XPay) and **Execute** (contract register / job accept) should refuse when that receipt does not PASS.

PASS fields (required when a receipt object is present, or always when strict env is on; **always** required on the ingest endpoint):

| Field | Rule |
| --- | --- |
| `source_hash` | Non-empty string (`sourceHash` accepted as alias) |
| `exactness.passed` | Must be `=== true` |

---

## Modes (request-body gate)

| Mode | Env | Behavior |
| --- | --- | --- |
| **Validate-when-present** (default) | `CUNI_CITIZEN_RECEIPT_REQUIRED` unset / not `true` | If `citizen_receipt` (or alias) is on the request, require PASS fields; if absent, continue. |
| **Strict / fail-closed** | `CUNI_CITIZEN_RECEIPT_REQUIRED=true` | Missing receipt → **400** `citizen_receipt_required`. Invalid shape → **400** `citizen_receipt_invalid`. |

Default is **off** (strict mode not enabled) for settle / claim / contracts body gate.

---

## Studio → Rider HTTP receive (cutover)

Primary ingest (preferred for CuNi Code Unity):

```http
POST /api/v0/citizen-receipts
Content-Type: application/json
Authorization: Bearer <CUNI_STUDIO_INGEST_KEY>
# or: X-Cuni-Ingest-Key: <CUNI_STUDIO_INGEST_KEY>
# or: X-Merchant-Key / Authorization: Bearer <participant api_key>
```

```json
{
  "citizen_receipt": {
    "source_hash": "sha256-hex-of-source",
    "exactness": { "passed": true, "checkedAt": "2026-09-24T17:00:00Z", "targets": ["py", "go", "js"] }
  },
  "bind": {
    "agent_id": "optional-agent-id",
    "job_id": "optional-job-id",
    "contract_id": "optional-contract-id",
    "task_id": "optional-task-id"
  },
  "publisher": "studio",
  "studio": "called"
}
```

**Auth (first match):**

1. `CUNI_STUDIO_INGEST_KEY` via `Authorization: Bearer` or `X-Cuni-Ingest-Key` (preferred Studio shared secret)
2. `X-Merchant-Key` (active / trialing Merchant Gate)
3. `Authorization: Bearer <participant api_key>`
4. Temporary open ingest only when `CUNI_CITIZEN_RECEIPT_INGEST_OPEN=true` (default **off**)

**Responses:** **201** new bind · **200** idempotent on `source_hash` · **400** missing/invalid · **401** unauthorized.

**Lookup:** `GET /api/v0/citizen-receipts?hash=<source_hash>`

**Compat:** `POST /api/v0/contracts` still accepts Studio publish meta + `citizen_receipt` and **binds** the receipt to the registered contract when PASS. Prefer the dedicated ingest path for receipt-only pushes.

Schema (optional durable store): `supabase/cuni_citizen_receipts.sql` (in-process memory always binds for the running instance).

---

## Hooked paths (body gate)

| Path | Role in T→F→E |
| --- | --- |
| `POST /api/v0/citizen-receipts` | Translate ingress — Studio/merchant/agent push + bind |
| `POST /api/v0/contracts` | Execute — register verified CuNi publish (+ bind receipt when present) |
| `POST /api/settle` | Fund — Rider **XPay** hop settle (not PCC) |
| `POST /api/tasks/claim` | Execute — job accept |
| `POST /api/first-job` `action=claim` | Execute — practice job accept |

Modules: `src/lib/cuni-citizen-gate.ts`, `src/lib/cuni-citizen-receipt-store.ts`, `src/lib/cuni-studio-pass.ts`.  
Selftests: `npm run selftest:cuni-citizen-gate` · `npm run selftest:cuni-citizen-receipt-http` · `npm run selftest:cuni-studio-pass` (from `src/`).

---

## Request shape (body gate / settle / claim)

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

Body-gate error bodies include `studio: "not_called"` so clients do not mistake a local refuse for a live Studio round-trip.  
Ingest responses use `studio_roundtrip: "not_applicable"` (Rider receive only).

---

## Honesty — Studio wire

| Claim | Truth today |
| --- | --- |
| Local PASS-field gate on Rider | **Wired** |
| Rider HTTP **receive** for Studio citizen receipts (`POST /api/v0/citizen-receipts`) | **Wired** (unchanged — #57) |
| Contracts register binds `citizen_receipt` when present | **Wired** (receive; does **not** re-call Studio `/api/pass`) |
| Rider → Studio Execute verify (`POST /api/pass`) | **WIRED (env-gated)** — default off; `CUNI_STUDIO_PASS_REQUIRED=true` or `studio_pass: true` |
| Soft “always live” Studio gate from Rider | **Forbidden** while default is off — honesty = env-gated |
| Live Studio→Rider push observed on Fly | **Only if** CuNi Studio has `CUNI_RIDER_URL` set and is deployed with push code — Rider is ready to receive |

PCC cash face remains https://www.slidphilabs.com/pcc — **never** fund/pay. Rider = identity / settle / attest.

---

## Fund path reminder

Hop **Fund** is **Rider `POST /api/settle` → XPay** (Base USDC / x402). Do **not** describe PCC as the money layer. Board credits remain non-hop (**410**). AMP dual-rail stays tracked in [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) until certified.

---

## Env

```
# Optional strict citizen receipt gate on settle/claim/contracts body. Default off.
CUNI_CITIZEN_RECEIPT_REQUIRED=false

# Rider → Studio Execute verify (POST /api/pass). Default off for safe merge.
# After Cos GREEN: fly secrets set CUNI_STUDIO_PASS_REQUIRED=true -a agentrider
CUNI_STUDIO_PASS_REQUIRED=false
# Optional override (no trailing slash). Default https://cuni-studio.fly.dev
CUNI_STUDIO_URL=https://cuni-studio.fly.dev

# Shared secret for Studio → Rider receipt ingest (preferred).
# Never commit the real value. fly secrets set CUNI_STUDIO_INGEST_KEY=... -a agentrider
CUNI_STUDIO_INGEST_KEY=

# Temporary open ingest without key/merchant/api_key. Default off.
CUNI_CITIZEN_RECEIPT_INGEST_OPEN=false
```

Never put `ar_` values, Studio secrets, or JWTs in docs or logs.
