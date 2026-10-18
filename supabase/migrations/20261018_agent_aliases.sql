-- Agent identity aliases: one agent, many historical ids, one canonical id.
-- Threads (direct_messages) and rate limits key on raw agent ids, so every
-- remint orphans history. This table maps every retired id to its canonical
-- successor; src/lib/identity.ts follows the chain on every DM send/read.
-- agent_id has no FK on purpose (merchant-issued riders routinely name
-- agents that never registered — same rationale as rider_renewal_tokens).
CREATE TABLE IF NOT EXISTS agent_aliases (
  alias         TEXT PRIMARY KEY,
  canonical_id  TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_aliases_canonical ON agent_aliases(canonical_id);

-- Grants (service_role) — re-assert after ALTER
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
