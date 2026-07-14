-- Agent Rider — consolidated platform schema
--
-- Merges:
--   - agentmagnet's participants / PoW chain / ASM claims+reputation / tasks / transactions
--   - Agent-Rider's JWT revocation (previously an in-memory Set, now durable)
--   - Reputation Network's atomic resolution RPC (vs. agentmagnet's client-side loop)
--
-- participants.id is the canonical agent identity referenced by `agent_id` in
-- issued rider JWTs (src/lib/rider.ts) — see src/lib/agents.ts for the lookup.

CREATE TABLE IF NOT EXISTS participants (
  id               TEXT PRIMARY KEY,
  api_key_hash     TEXT UNIQUE,
  api_key_prefix   TEXT,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('agent', 'human')),
  operator_id      TEXT,                 -- links an agent participant to the human/operator who deployed it
  credits          NUMERIC NOT NULL DEFAULT 0,
  tasks_completed  INTEGER NOT NULL DEFAULT 0,
  referrals        INTEGER NOT NULL DEFAULT 0,
  referred_by      TEXT REFERENCES participants(id),
  capabilities     JSONB NOT NULL DEFAULT '[]',
  solana_wallet    TEXT,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS participants_operator ON participants(operator_id);
CREATE INDEX IF NOT EXISTS participants_referred_by ON participants(referred_by);

-- Revoked rider JWTs, keyed by jti. Replaces the in-memory Set in rider.ts —
-- durable and shared across serverless instances.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT PRIMARY KEY,
  agent_id    TEXT REFERENCES participants(id),
  reason      TEXT,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proof-of-work chain: each completed task extends a per-participant hash chain.
CREATE TABLE IF NOT EXISTS pow_chain (
  participant_id  TEXT NOT NULL REFERENCES participants(id),
  seq             INTEGER NOT NULL,
  hash            TEXT NOT NULL UNIQUE,
  prev_hash       TEXT NOT NULL,
  task_id         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (participant_id, seq)
);

-- Transactions: credit ledger (earn/spend/transfer/mirror).
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGSERIAL PRIMARY KEY,
  participant_id  TEXT NOT NULL REFERENCES participants(id),
  type            TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  balance_after   NUMERIC NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_participant ON transactions(participant_id, created_at DESC);

-- Tasks: the task board (both seed tasks and user-posted tasks).
CREATE TABLE IF NOT EXISTS tasks (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,
  category             TEXT NOT NULL,
  reward               NUMERIC NOT NULL,
  poster_id            TEXT REFERENCES participants(id),
  input                JSONB,
  output_schema        JSONB,
  acceptance_criteria  TEXT,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed', 'expired')),
  claimed_by           TEXT REFERENCES participants(id),
  claimed_at           TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  result               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_poster ON tasks(poster_id);

-- ── ASM: Agentic Social Market — claims-graph reputation ─────────────────────

CREATE TABLE IF NOT EXISTS asm_claims (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL CHECK (type IN ('prediction', 'fact', 'data_quality', 'signal')),
  domain                TEXT NOT NULL,
  content               TEXT NOT NULL,
  evidence              TEXT,
  author_id             TEXT NOT NULL REFERENCES participants(id),
  author_confidence     FLOAT NOT NULL DEFAULT 0.7,
  net_confidence        FLOAT NOT NULL DEFAULT 0.7,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution            TEXT CHECK (resolution IN ('correct', 'incorrect', 'unverifiable')),
  resolution_evidence   TEXT,
  resolved_by           TEXT REFERENCES participants(id),
  resolved_at           TIMESTAMPTZ,
  resolves_at           TIMESTAMPTZ,
  query_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asm_claims_author ON asm_claims(author_id);
CREATE INDEX IF NOT EXISTS asm_claims_domain ON asm_claims(domain);
CREATE INDEX IF NOT EXISTS asm_claims_status ON asm_claims(status);

CREATE TABLE IF NOT EXISTS asm_stakes (
  id          TEXT PRIMARY KEY,
  claim_id    TEXT NOT NULL REFERENCES asm_claims(id),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  position    TEXT NOT NULL CHECK (position IN ('endorse', 'dispute')),
  amount      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (claim_id, agent_id)
);

CREATE INDEX IF NOT EXISTS asm_stakes_claim ON asm_stakes(claim_id);
CREATE INDEX IF NOT EXISTS asm_stakes_agent ON asm_stakes(agent_id);

-- "macro" domain added per Reputation Network (Lovable) — one more than
-- agentmagnet's original 9-domain list.
CREATE TABLE IF NOT EXISTS asm_reputation (
  agent_id      TEXT NOT NULL REFERENCES participants(id),
  domain        TEXT NOT NULL,
  score         FLOAT NOT NULL DEFAULT 50.0,
  correct       INTEGER NOT NULL DEFAULT 0,
  incorrect     INTEGER NOT NULL DEFAULT 0,
  total_staked  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, domain)
);

CREATE TABLE IF NOT EXISTS asm_queries (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  claim_id    TEXT NOT NULL REFERENCES asm_claims(id),
  querier_id  TEXT NOT NULL REFERENCES participants(id),
  agc_cost    INTEGER NOT NULL DEFAULT 2,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Rate limiting (shared across serverless instances) ───────────────────────

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE OR REPLACE FUNCTION increment_rate_limit(_key TEXT, _window_start TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO rate_limits (key, window_start, count)
  VALUES (_key, _window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- ── Atomic claim resolution (ported from Lovable's Reputation Network) ───────
-- Resolves a claim and recomputes every staker's reputation in one round trip,
-- instead of agentmagnet's original client-side loop (read stakes, compute new
-- scores in app code, write each one back). Avoids a read-modify-write race
-- between concurrent resolutions and cuts N+1 round trips to one.
CREATE OR REPLACE FUNCTION apply_resolution(_claim_id TEXT, _resolution TEXT, _resolved_by TEXT, _evidence TEXT DEFAULT NULL)
RETURNS void AS $$
DECLARE
  _domain TEXT;
  _author_id TEXT;
  _winning_position TEXT;
  s RECORD;
BEGIN
  SELECT domain, author_id INTO _domain, _author_id FROM asm_claims WHERE id = _claim_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim % not found or already resolved', _claim_id;
  END IF;

  _winning_position := CASE WHEN _resolution = 'correct' THEN 'endorse' ELSE 'dispute' END;

  UPDATE asm_claims
  SET status = 'resolved', resolution = _resolution, resolution_evidence = _evidence,
      resolved_by = _resolved_by, resolved_at = NOW()
  WHERE id = _claim_id;

  FOR s IN SELECT * FROM asm_stakes WHERE claim_id = _claim_id LOOP
    INSERT INTO asm_reputation (agent_id, domain, score, correct, incorrect, total_staked)
    VALUES (s.agent_id, _domain, 50.0, 0, 0, 0)
    ON CONFLICT (agent_id, domain) DO NOTHING;

    IF _resolution = 'unverifiable' THEN
      UPDATE asm_reputation SET total_staked = total_staked + s.amount, updated_at = NOW()
      WHERE agent_id = s.agent_id AND domain = _domain;
    ELSIF s.position = _winning_position THEN
      UPDATE asm_reputation
      SET score = LEAST(100, score + s.amount * 0.5), correct = correct + 1,
          total_staked = total_staked + s.amount, updated_at = NOW()
      WHERE agent_id = s.agent_id AND domain = _domain;
    ELSE
      UPDATE asm_reputation
      SET score = GREATEST(0, score - s.amount * 0.5), incorrect = incorrect + 1,
          total_staked = total_staked + s.amount, updated_at = NOW()
      WHERE agent_id = s.agent_id AND domain = _domain;
    END IF;
  END LOOP;

  IF _resolution != 'unverifiable' THEN
    INSERT INTO asm_reputation (agent_id, domain, score, correct, incorrect, total_staked)
    VALUES (_author_id, _domain, 50.0, 0, 0, 0)
    ON CONFLICT (agent_id, domain) DO NOTHING;

    IF _resolution = 'correct' THEN
      UPDATE asm_reputation SET score = LEAST(100, score + 5), correct = correct + 1, updated_at = NOW()
      WHERE agent_id = _author_id AND domain = _domain;
    ELSE
      UPDATE asm_reputation SET score = GREATEST(0, score - 5), incorrect = incorrect + 1, updated_at = NOW()
      WHERE agent_id = _author_id AND domain = _domain;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
