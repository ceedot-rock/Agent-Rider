# Coord — CuNi Code Unity ↔ Agent-Rider citizen receipt interface

**Date stamp:** 2026-09-24 (America/New_York)  
**Audience:** CuNi Code Unity (Studio / publish / PASS gate)  
**Rider seat (coord):** agent^rider — parent already DMed CuNi on Rider.  
**Locks:** Never paste `ar_` / ingest secrets into chat · Fund = Rider settle / XPay (never PCC) · Exactness or refuse.

Full Rider doc: [`CUNI_CITIZEN_GATE.md`](./CUNI_CITIZEN_GATE.md)

---

## Exact interface (Rider receive — ready)

### Preferred: dedicated ingest

```http
POST {CUNI_RIDER_URL}/api/v0/citizen-receipts
Content-Type: application/json
Authorization: Bearer <CUNI_STUDIO_INGEST_KEY>
X-Cuni-Studio: called
```

`CUNI_RIDER_URL` example: `https://agentrider.fly.dev`

Body (PASS only — never push FAIL):

```json
{
  "citizen_receipt": {
    "source_hash": "<sha256 hex of .cuni source>",
    "sourceHash": "<same>",
    "exactness": {
      "passed": true,
      "checkedAt": "<iso8601 optional>",
      "targets": ["py", "go", "js"],
      "stdoutMatch": true
    }
  },
  "bind": {
    "agent_id": "<optional>",
    "job_id": "<optional>",
    "contract_id": "<optional>",
    "task_id": "<optional>"
  },
  "publisher": "studio",
  "studio": "called"
}
```

**PASS fields Rider requires:** `source_hash` non-empty · `exactness.passed === true`.

**Success:** HTTP **201** (new) / **200** (idempotent on `source_hash`) with `receipt_id`, `source_hash`, `bind`, `studio_roundtrip: "not_applicable"`.

**Refuse:** **400** `citizen_receipt_required` | `citizen_receipt_invalid` · **401** `unauthorized_ingest`.

**Lookup:** `GET {CUNI_RIDER_URL}/api/v0/citizen-receipts?hash=<source_hash>`

### Compat (existing Studio push)

Studio may continue:

```http
POST {CUNI_RIDER_URL}/api/v0/contracts
Content-Type: application/json
X-Cuni-Studio: called
```

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

Rider registers the contract **and** binds the citizen receipt to `contract_id` when PASS.

### Auth for ingest

| Mode | How |
| --- | --- |
| Shared ingest key (preferred) | Rider `CUNI_STUDIO_INGEST_KEY` = Studio secret; send as Bearer or `X-Cuni-Ingest-Key` |
| Merchant | `X-Merchant-Key` (active/trialing) |
| Agent | Bearer participant `api_key` |
| Temporary open | Rider `CUNI_CITIZEN_RECEIPT_INGEST_OPEN=true` (default off — avoid in prod) |

---

## Honesty (both sides)

| Side | Truth |
| --- | --- |
| Rider receive HTTP | **Ready** on this branch once shipped |
| Rider → Studio outbound verify (`POST /api/pass` call) | **PARKED** — Rider does not call Studio yet |
| Studio → Rider push live on Fly | Only after CuNi deploy + `CUNI_RIDER_URL` (+ ingest key if required) |
| PCC | Cash face only — **never** fund/pay |

---

## Smoke (after Rider deploy)

```bash
# Replace KEY with the shared ingest secret (never commit/log it)
curl -sS -X POST https://agentrider.fly.dev/api/v0/citizen-receipts \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CUNI_STUDIO_INGEST_KEY" \
  -d '{"citizen_receipt":{"source_hash":"abc","exactness":{"passed":true}},"studio":"called"}'
```

FAIL must 400:

```bash
curl -sS -X POST https://agentrider.fly.dev/api/v0/citizen-receipts \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CUNI_STUDIO_INGEST_KEY" \
  -d '{"citizen_receipt":{"source_hash":"abc","exactness":{"passed":false}}}'
```

---

## Rider flags

```
CUNI_CITIZEN_RECEIPT_REQUIRED=false   # settle/claim/contracts body strict (default off)
CUNI_STUDIO_INGEST_KEY=               # shared Studio ingest secret
CUNI_CITIZEN_RECEIPT_INGEST_OPEN=false
```
