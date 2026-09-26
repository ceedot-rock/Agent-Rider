# Rider × CuNi — call / gate / refuse-pass map

**Status:** DRAFT (CoS green 2026-09-26 for docs draft; public publish later).
**Date:** 2026-09-26 · Owner: Odin (Rider side, KICK lane 1)

## The one law

Rider refuses when Studio refuses. PASS only when Studio returns PASS **and** the environment gate permits it. Rider never softens a Studio REFUSE.

## Calls

| # | Direction | Call | Purpose |
|---|-----------|------|---------|
| 1 | Rider → Studio | `POST {studio}/api/pass` `{source}` | Execute verify: exactness gate before job accept / contract register |
| 2 | Studio → Rider | `POST /api/v0/citizen-receipts` `{citizen_receipt, bind}` | Ingest PASS receipts (Translate → Fund → Execute) |
| 3 | Studio → Rider | `POST /api/v0/contracts` `{source, sourceHash, exactness}` | Publish exactness-passed contracts (Studio enforces before POST) |

`{studio}` = `CUNI_STUDIO_URL` or default `https://cuni-studio.fly.dev`. Timeout 15s.

## Gates (Rider side)

| Gate | Env | Default | Behavior |
|------|-----|---------|----------|
| Studio Execute verify | `CUNI_STUDIO_PASS_REQUIRED` | **OFF** | ON: every Execute body round-trips `/api/pass` fail-closed. OFF: skips unless `body.studio_pass === true`. |
| Citizen receipt shape | `CUNI_CITIZEN_RECEIPT_REQUIRED` | **OFF** (validate-when-present) | Receipt present → require `source_hash` + `exactness.passed === true`. Strict ON → missing receipt is 400. |
| Sealed ride / attestation | — | **PARKED** | `GET /api/attestation` → **501** `host_attestation_planned`. Not live. Never claim otherwise. |

Wired into: `POST /api/tasks/claim`, `POST /api/first-job` (claim), `POST /api/v0/contracts`, `POST /api/settle`. Receive path (`/api/v0/citizen-receipts`) never re-calls Studio.

## Refuse / pass matrix (verified live 2026-09-26)

| Case | Result |
|------|--------|
| Missing source (gate on) | **REFUSE** — 400 `missing source`, Studio not called |
| Broken source (exactness fails) | **REFUSE** — 400, Studio `verdict: REFUSE` forwarded verbatim |
| Good source (`spend_control.cuni`) | **PASS** — gate ok, `studio: "called"`, `citizen_receipt.source_hash` returned |
| Studio unreachable (gate on) | **REFUSE** — 503 fail-closed, never pass-through |

## Locks (do not move without CoS)

- `CUNI_STUDIO_PASS_REQUIRED` stays **OFF** until CoS authorizes (re-smoke first).
- Execute gate stays OFF; no Fly `required=true` without CoS green.
- Claim face stays human-derived. **Fund ≠ PCC.** Stamp stays **43.72M**. Attest stays **501**.
- CuNi owns AST/M1–M2 exactness + Studio `/api/pass`. Rider owns claim, first job, Execute gate, sealed ride/attest, Host Chat.
- No `ar_` / JWT / key material in docs, PRs, logs, or envelopes — ever.

## PRs

- #62 Rider→Studio `/api/pass` (env-gated) — **MERGED**
- #63 Host Chat Lab Team delivery — **MERGED**
- #64 Grok roster seat — **MERGED**
- #60 Attestation/sealed route hooks (OFF) — **MERGED**
