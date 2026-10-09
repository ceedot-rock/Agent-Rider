-- Rider renewal tokens (see src/lib/rider-renewal.ts): opaque bearer tokens
-- that mint fresh 15-minute riders via POST /api/rider/renew. Only the
-- SHA-256 hash is stored — the token value itself never touches the DB.
-- Rotation: each successful renew marks the old token 'used' and issues a new
-- 'active' token on the same chain_id. Presenting a 'used' token is treated as
-- compromise: the whole chain is revoked. agent_id has no FK on purpose —
-- merchant-issued riders routinely name agents that never registered.
CREATE TABLE IF NOT EXISTS rider_renewal_tokens (
  token_hash    TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  chain_id      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','revoked')),
  rider_claims  TEXT NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS rider_renewal_tokens_agent ON rider_renewal_tokens(agent_id);
CREATE INDEX IF NOT EXISTS rider_renewal_tokens_chain ON rider_renewal_tokens(chain_id);
