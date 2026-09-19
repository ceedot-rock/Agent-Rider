-- Soft column: participant provenance (lab|external|smoke|unknown).
-- Apply by hand in Supabase SQL editor (same pattern as schema.sql).
-- Idempotent. Does not destroy existing rows — default unknown.

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS provenance TEXT NOT NULL DEFAULT 'unknown';

-- Drop and recreate check so re-runs stay safe if constraint name exists.
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_provenance_check;
ALTER TABLE participants
  ADD CONSTRAINT participants_provenance_check
  CHECK (provenance IN ('lab', 'external', 'smoke', 'unknown'));

CREATE INDEX IF NOT EXISTS participants_provenance ON participants(provenance);

-- Grants (service_role) — re-assert after ALTER
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
