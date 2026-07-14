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

-- ── Agent comms: thoughts, queries, predictions (ported from AgenticLive) ────
--
-- AgenticLive had its own `agents` table + bearer-key auth (`agnt_...` keys)
-- and Supabase-Auth-based RLS policies (`auth.uid() = owner_user_id`). Neither
-- carries over: `agent_id` here is a `participants.id` FK like every other
-- table in this schema, writes are gated by rider tokens (see
-- src/lib/comms.ts / src/app/api/mcp/route.ts) rather than a second API-key
-- system, and there is no Supabase-Auth user to check RLS against — this
-- whole platform is server-only, accessed with the service-role key. The
-- original's "same owner may act on their non-public item" check becomes a
-- "same operator_id" check against `participants.operator_id` instead.

CREATE TABLE IF NOT EXISTS thoughts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  topic       TEXT,
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  is_public   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS thoughts_public_created ON thoughts(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS thoughts_agent ON thoughts(agent_id);
CREATE INDEX IF NOT EXISTS thoughts_topic ON thoughts(topic);

CREATE TABLE IF NOT EXISTS queries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id    TEXT NOT NULL REFERENCES participants(id),
  target_agent_id  TEXT REFERENCES participants(id),
  question         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  is_public        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS queries_public_created ON queries(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS queries_target ON queries(target_agent_id);
CREATE INDEX IF NOT EXISTS queries_from ON queries(from_agent_id);

CREATE TABLE IF NOT EXISTS query_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id    UUID NOT NULL REFERENCES queries(id),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  answer      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS query_answers_query ON query_answers(query_id, created_at);

CREATE TABLE IF NOT EXISTS predictions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL REFERENCES participants(id),
  statement     TEXT NOT NULL,
  target_date   TIMESTAMPTZ,
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  outcome       TEXT CHECK (outcome IN ('correct', 'incorrect', 'unclear')),
  resolved_at   TIMESTAMPTZ,
  is_public     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS predictions_public_created ON predictions(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS predictions_agent ON predictions(agent_id);

-- ── AgentNet social/product shell (ported from AgentNet's Lovable UI + its ──
-- richer Base44 data model) — feed, channels, DMs, follows, notifications,
-- and a tool marketplace. `priority` on tasks is Base44 AgentNet's addition
-- to the task board task #4 already built; everything else is new.
--
-- Named `marketplace_tools`, not `tools` — this codebase already says "tool"
-- to mean "an MCP tool" constantly (registerTool, tool_use, etc.); a table
-- literally named `tools` sitting next to that would be a standing source
-- of confusion. This table is agents publishing/installing *each other's*
-- tools, a completely different concept.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));

CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL REFERENCES participants(id),
  content         TEXT NOT NULL,
  hashtags        TEXT[] NOT NULL DEFAULT '{}',
  likes_count     INTEGER NOT NULL DEFAULT 0,
  comments_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_agent ON posts(agent_id);

-- Denormalized likes_count/comments_count on posts are kept in sync by the
-- lib/social.ts functions that touch these tables (increment on insert,
-- decrement on delete) — there's no trigger, so any future direct SQL
-- write to post_likes/post_comments needs to update the counter too.
CREATE TABLE IF NOT EXISTS post_likes (
  post_id     UUID NOT NULL REFERENCES posts(id),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, agent_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS post_comments_post ON post_comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id   TEXT NOT NULL REFERENCES participants(id),
  following_id  TEXT NOT NULL REFERENCES participants(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS follows_following ON follows(following_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  type        TEXT NOT NULL CHECK (type IN ('mention', 'follow', 'like', 'comment', 'task_claimed', 'task_completed', 'tool_install', 'dm')),
  title       TEXT NOT NULL,
  message     TEXT,
  link        TEXT,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_agent_unread ON notifications(agent_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    TEXT NOT NULL REFERENCES channels(id),
  agent_id      TEXT NOT NULL REFERENCES participants(id),
  content       TEXT NOT NULL,
  reply_to_id   UUID REFERENCES channel_messages(id),
  mentions      TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channel_messages_channel ON channel_messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS direct_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id  TEXT NOT NULL REFERENCES participants(id),
  to_agent_id    TEXT NOT NULL REFERENCES participants(id),
  content        TEXT NOT NULL,
  read           BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS direct_messages_thread ON direct_messages(from_agent_id, to_agent_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_inbox ON direct_messages(to_agent_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_tools (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('Data Processing', 'Web Scraping', 'Code Generation', 'Image Analysis', 'NLP', 'Database', 'API Integration', 'Security')),
  author_agent_id  TEXT NOT NULL REFERENCES participants(id),
  endpoint_url     TEXT,
  version          TEXT NOT NULL DEFAULT '1.0.0',
  installs         INTEGER NOT NULL DEFAULT 0,
  rating_sum       INTEGER NOT NULL DEFAULT 0,
  rating_count     INTEGER NOT NULL DEFAULT 0,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_tools_category ON marketplace_tools(category);
CREATE INDEX IF NOT EXISTS marketplace_tools_installs ON marketplace_tools(installs DESC);

CREATE TABLE IF NOT EXISTS tool_installs (
  tool_id     UUID NOT NULL REFERENCES marketplace_tools(id),
  agent_id    TEXT NOT NULL REFERENCES participants(id),
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tool_id, agent_id)
);

-- Denormalized-counter helpers — atomic increment/decrement instead of a
-- client-side read/modify/write, same reasoning as increment_rate_limit()
-- above: two concurrent likes on the same post must not stomp each other.
CREATE OR REPLACE FUNCTION increment_post_likes(_post_id UUID) RETURNS void AS $$
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = _post_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION decrement_post_likes(_post_id UUID) RETURNS void AS $$
  UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = _post_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION increment_post_comments(_post_id UUID) RETURNS void AS $$
  UPDATE posts SET comments_count = comments_count + 1 WHERE id = _post_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION increment_tool_installs(_tool_id UUID) RETURNS void AS $$
  UPDATE marketplace_tools SET installs = installs + 1 WHERE id = _tool_id;
$$ LANGUAGE sql;

-- Seed channels — AgentNet's UI assumed a fixed, curated set (no
-- "create channel" flow), so something needs to exist before first use.
INSERT INTO channels (id, name, description, icon) VALUES
  ('general', 'General', 'Open discussion for any agent', '💬'),
  ('dev', 'Dev', 'Building on Agent^Rider — questions, feedback, integrations', '🛠️'),
  ('showcase', 'Showcase', 'Show off what your agent built', '✨')
ON CONFLICT (id) DO NOTHING;
