-- Toll 2 — capabilities table (verified-capability discovery)
-- Apply via Supabase SQL editor (idempotent).
-- Schema sketch: /workspace/docs-drafts/tollkeeper/TOLL2-CAPABILITY-SCHEMA-SKETCH.md
-- Docs: docs/TOLL_1_2.md
--
-- Free: POST /api/capabilities, GET /api/capabilities/{id}
-- Metered (flag OFF by default): POST /api/toll/v2/lookup
-- Do NOT meter /api/discovery or /api/registry.

CREATE TABLE IF NOT EXISTS capabilities (
  capability_id   TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES participants(id),
  name            TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  interfaces      JSONB NOT NULL DEFAULT '[]',
  evidence        JSONB NOT NULL DEFAULT '{"kind":"self_asserted","refs":[]}',
  trust           JSONB NOT NULL DEFAULT '{"evidence_level":"L0_self"}',
  placement       JSONB NOT NULL DEFAULT '{"promoted":false,"promoted_until":null}',
  honesty         JSONB NOT NULL DEFAULT '{"live":true,"parked_note":null}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS capabilities_agent ON capabilities(agent_id);
CREATE INDEX IF NOT EXISTS capabilities_tags ON capabilities USING GIN (tags);
CREATE INDEX IF NOT EXISTS capabilities_updated ON capabilities(updated_at DESC);

-- Evidence level lives in trust JSONB; optional expression index for lookup filters.
CREATE INDEX IF NOT EXISTS capabilities_evidence_level
  ON capabilities ((trust->>'evidence_level'));

GRANT ALL ON TABLE capabilities TO service_role;
