-- Toll 6 — 1% platform fee collected ON TOP of the bond at stake time
-- (Corey's 2026-09-30 call: bond stays whole, fee goes to TOLL_FEE_WALLET).
--
-- Widens toll_bond_events.kind to include 'fee' so the fee-forward movement
-- has a first-class event row. Backward-compatible: only widens the CHECK,
-- no column altered or dropped.

DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'toll_bond_events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%kind%stake%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE toll_bond_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'toll_bond_events_kind_check'
  ) THEN
    ALTER TABLE toll_bond_events
      ADD CONSTRAINT toll_bond_events_kind_check
      CHECK (kind IN ('stake', 'slash', 'release', 'fee'));
  END IF;
END $$;
