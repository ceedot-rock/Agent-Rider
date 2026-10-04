-- Promo codes for agent recruitment: 3 free months of Rider access.
-- One master code, up to 500 total redemptions; each comped agent may extend
-- the comp to up to 10 referred agents.
-- Apply by hand in Supabase SQL editor. Idempotent.
-- App code treats missing columns as "not comped" and retries inserts without
-- them, so this migration is safe to apply after deploy.

-- New columns on participants.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS comped_until TIMESTAMPTZ NULL DEFAULT NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS comped_via TEXT NULL DEFAULT NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS comped_referrals INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS participants_comped_until ON participants(comped_until);

-- Promo code registry. Only code hashes are stored; plaintext is shown once
-- at creation.
CREATE TABLE IF NOT EXISTS promo_codes (
  code_hash TEXT PRIMARY KEY,
  code_prefix TEXT NOT NULL,
  label TEXT NOT NULL,
  max_redemptions INTEGER NOT NULL DEFAULT 500,
  redemptions INTEGER NOT NULL DEFAULT 0,
  benefit_months INTEGER NOT NULL DEFAULT 3,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grants (service_role) — re-assert after ALTER
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
