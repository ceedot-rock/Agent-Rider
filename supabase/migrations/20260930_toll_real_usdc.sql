-- Toll Gates 3 & 6 — real USDC settlement on Base (chain 8453).
--
-- DO NOT APPLY without CoS green.
--
-- Backward-compatible: only ADDs nullable columns and one new table.
-- No existing column is altered or dropped. The mock tables
-- (toll_mock_ledger, toll_mock_balances) are left untouched here and get
-- dropped in a follow-up once the real paths are proven in production.

-- Gate 3 escrows: real deposit + payout data.
ALTER TABLE toll_escrows
  ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS payer_wallet TEXT,
  ADD COLUMN IF NOT EXISTS payout_wallet TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_uusdc BIGINT,
  ADD COLUMN IF NOT EXISTS release_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS fee_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT 8453,
  ADD COLUMN IF NOT EXISTS token_contract TEXT NOT NULL DEFAULT
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

-- One deposit funds exactly one escrow: the tx hash is the replay guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_toll_escrows_deposit_tx'
  ) THEN
    ALTER TABLE toll_escrows
      ADD CONSTRAINT uq_toll_escrows_deposit_tx UNIQUE (deposit_tx_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_toll_escrows_deposit_tx
  ON toll_escrows (deposit_tx_hash);

-- Gate 6 bonds: real deposit + payout data.
ALTER TABLE toll_bonds
  ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS staker_wallet TEXT,
  ADD COLUMN IF NOT EXISTS payout_wallet TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_uusdc BIGINT,
  ADD COLUMN IF NOT EXISTS release_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS slash_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT 8453,
  ADD COLUMN IF NOT EXISTS token_contract TEXT NOT NULL DEFAULT
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_toll_bonds_deposit_tx'
  ) THEN
    ALTER TABLE toll_bonds
      ADD CONSTRAINT uq_toll_bonds_deposit_tx UNIQUE (deposit_tx_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_toll_bonds_deposit_tx
  ON toll_bonds (deposit_tx_hash);

-- Bond events: which on-chain tx settled each event.
ALTER TABLE toll_bond_events
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

-- Append-only log of every outbound toll transfer Rider asked AwLPay to
-- send. tx_hash is the on-chain truth; idempotency_key is the no-double-send
-- guard shared with AwLPay.
CREATE TABLE IF NOT EXISTS toll_chain_transfers (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('release', 'fee', 'refund', 'slash')),
  ref_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  from_slot TEXT NOT NULL CHECK (from_slot IN ('escrow', 'bonds')),
  to_wallet TEXT NOT NULL,
  amount_uusdc BIGINT NOT NULL CHECK (amount_uusdc > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toll_chain_transfers_ref
  ON toll_chain_transfers (ref_id);
