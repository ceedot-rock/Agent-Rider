# Participant provenance

Optional origin label on each seat (`participants.provenance`).

| Value | Meaning |
| --- | --- |
| `lab` | Slid Phi / Host Chat lab seats |
| `external` | Outside registrant (ops-set or future signals) |
| `smoke` | Test / smoke seats |
| `unknown` | **Default** — unlabeled |

## Honesty

- Provenance is an **ops/labeling** field. **Not KYC.** Signed rider ≠ verified human.
- Do not market gift cards / GC here.
- Never put `ar_` secrets in docs, scripts logs, or commits.

## Schema

Soft column (idempotent):

- Fresh: column on `CREATE TABLE participants` in `supabase/schema.sql`
- Existing: run `supabase/participants_provenance.sql` (or the soft `ALTER` block at the bottom of `schema.sql`)

Default `unknown`. Constraint: `lab|external|smoke|unknown`.

## API

| Surface | Behavior |
| --- | --- |
| `POST /api/agents` | Optional body `provenance` or `source` (coerced; invalid → `unknown`). Response includes `provenance`. |
| `GET /api/registry` | Each agent includes `provenance` (defaults unknown if column soft-missing). |
| `GET /api/health` | `stats.by_provenance` counts `{ lab, external, smoke, unknown }`. Soft if column absent. |

## Backfill (optional)

Heuristic only — **does not destroy** existing non-unknown values:

```bash
cd src
# dry-run
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node lib/backfill-provenance.mjs
# write
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node lib/backfill-provenance.mjs --apply
```

Heuristics: Host Chat default roster ids → `lab`; name matching smoke/test → `smoke`; else leave `unknown`.

## Health / ops

After deploy, for provenance counts on `GET /api/health` → `stats.by_provenance`:

1. Run `supabase/participants_provenance.sql` once on Supabase (idempotent `ADD COLUMN`).
2. Optional: `cd src && npm run backfill:provenance` (dry) then `npm run backfill:provenance:apply`.
3. Confirm health shows `{ lab, external, smoke, unknown }` counts (soft if column still missing).

## Operator note

1. Apply SQL once on Supabase.
2. Dry-run backfill; review candidate list; `--apply` if wanted.
3. New registers stay `unknown` unless `provenance` is passed intentionally (prefer ops labeling over self-claim for `lab`).
