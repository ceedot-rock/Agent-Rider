-- CuNi citizen receipts (Studio → Rider HTTP receive / Execute bind)
-- Apply via Supabase SQL editor (idempotent).
-- See docs/CUNI_CITIZEN_GATE.md

CREATE TABLE IF NOT EXISTS cuni_citizen_receipts (
  id            TEXT PRIMARY KEY,
  source_hash   TEXT NOT NULL UNIQUE,
  exactness     JSONB NOT NULL DEFAULT '{}',
  agent_id      TEXT,
  job_id        TEXT,
  contract_id   TEXT,
  task_id       TEXT,
  publisher     TEXT NOT NULL DEFAULT 'studio',
  bind          JSONB NOT NULL DEFAULT '{}',
  ingress       TEXT NOT NULL DEFAULT 'studio_http',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cuni_citizen_receipts_received
  ON cuni_citizen_receipts(received_at DESC);
CREATE INDEX IF NOT EXISTS cuni_citizen_receipts_contract
  ON cuni_citizen_receipts(contract_id);
CREATE INDEX IF NOT EXISTS cuni_citizen_receipts_agent
  ON cuni_citizen_receipts(agent_id);

GRANT ALL ON TABLE cuni_citizen_receipts TO service_role;
