-- CuNi contract registry (Studio → Rider cutover)
-- Apply via Supabase SQL editor (idempotent).

CREATE TABLE IF NOT EXISTS cuni_contracts (
  id            TEXT PRIMARY KEY,
  source_hash   TEXT NOT NULL UNIQUE,
  source        TEXT NOT NULL,
  exactness     JSONB NOT NULL DEFAULT '{}',
  links         JSONB NOT NULL DEFAULT '[]',
  publisher     TEXT NOT NULL DEFAULT 'studio',
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cuni_contracts_created ON cuni_contracts(created_at DESC);
CREATE INDEX IF NOT EXISTS cuni_contracts_status ON cuni_contracts(status);

GRANT ALL ON TABLE cuni_contracts TO service_role;
