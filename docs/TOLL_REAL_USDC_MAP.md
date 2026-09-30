# Toll Gates 3 & 6 — Real USDC Settlement Map

Corey's order (2026-09-29): no mock. Gates 3 (escrow) and 6 (bonds) settle in
real USDC (USD Coin) on Base (chain ID 8453). This doc maps every mock
touchpoint, the AwLPay wallet integration, the new data contract, and the
exact transaction plan gates. Nothing here moves funds — see "Approvals".

## 1. Current mock touchpoints (all must die)

### Gate 3 — `src/app/api/toll/v3/escrow/route.ts` (lock)
- `mockTxHash(...)` fabricates `lock_tx` and `fee_tx`.
- Writes 2 rows to `toll_mock_ledger` (lock + 1% fee to `lab:fees`).
- `toll_escrows.lock_tx` stores a fake hash (`""` at insert, patched after).

### Gate 3 — `src/app/api/toll/v3/escrow/release/route.ts` (release)
- `mockTxHash(...)` fabricates `release_tx` to `agent_id`.
- Writes 1 row to `toll_mock_ledger`.
- `status: locked → released` flip has a good double-release guard
  (`.eq("status","locked")`) — keep this pattern.

### Gate 6 — `src/app/api/toll/v6/bonds/stake/route.ts` (stake)
- Balance check reads `toll_mock_balances` (fake money).
- Debit/credit moves stake into a `bond:<bond_id>` row in `toll_mock_balances`.
- The 402 `insufficient_balance` body already points at real Base USDC
  (added in 660e109) — copy stays, plumbing must catch up.

### Gate 6 — `src/app/api/toll/v6/bonds/slash/route.ts` (slash)
- Moves `slashAmt` from `bond:<bond_id>` to recipient inside
  `toll_mock_balances`. Evidence verification (lab-signed attestation,
  trigger matching) is real and stays.

### Shared
- `toll_mock_ledger` / `toll_mock_balances`: retired, never written by the
  new code paths. (Keep tables until migration is proven; then drop.)
- `escrowAcct()` / `mockTxHash()` in `toll-3-core.mjs`: mock addressing —
  replaced by real wallet addresses.

## 2. Division of labor

- **Agent Rider** owns: toll policy, identities, fee math, DB records,
  receipts/envelopes, the public API surface.
- **AwLPay** owns: wallet verification, offline signing, broadcast.
  Reuse the proven x402 verification law (`rider-x402/server.py`):
  correct chain, canonical USDC contract
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, successful receipt,
  Transfer-event sum ≥ expected, payer binding, replay protection.

## 3. New AwLPay internal endpoints (authenticated, service secret)

All require `TOLL_MAINNET_AUTHORIZED=1`, Base 8453 only, canonical USDC only.

| Endpoint | Purpose |
|---|---|
| `POST /internal/toll/deposit/verify` | Verify a payer's on-chain USDC transfer into the escrow/bond wallet. Returns confirmed amount (micro-USDC), payer address, block, replay key. Read-only. |
| `POST /internal/toll/send` | Sign+broadcast one toll USDC transfer from the slot wallet. Body: `{slot, to_address, amount_uusdc, idempotency_key, purpose}`. Amounts/recipients are Rider's policy; this endpoint enforces the toll law. |

Built 2026-09-30 (all in `~/workspace/agent-rider-work`, NOT yet committed or
deployed; migration NOT applied — needs CoS green):

- `supabase/migrations/20260930_toll_real_usdc.sql` — new columns on
  `toll_escrows`/`toll_bonds` (deposit_tx_hash UNIQUE, payer/staker/payout
  wallets, confirmed amounts, release/slash/fee/refund tx hashes,
  chain_id 8453, canonical USDC) + `toll_chain_transfers` append-only log.
- `src/lib/toll-settle.ts` — Rider client for AwLPay:
  `verifyTollDeposit()`, `tollSend()`, `assertBaseAddress()`.
- `src/app/api/toll/v3/escrow/route.ts` — lock now requires
  `deposit_tx_hash` + `payer_sig` + `payout_wallet`; verifies the real
  deposit BEFORE insert; 409 on replayed tx hash; no mock writes.
- `src/app/api/toll/v3/escrow/release/route.ts` — release sends 99% to the
  payout wallet + 1% to `TOLL_FEE_WALLET` (two idempotent Base USDC
  transfers); locked→releasing→released flips; crash recovery via the same
  idempotency keys; REFUSES mock-era escrows (no deposit proof → no money).
- `src/app/api/toll/v6/bonds/stake/route.ts` — stake requires
  `deposit_tx_hash` + `payer_sig` + `payout_wallet`; verifies before insert;
  all `toll_mock_balances` logic removed; 1% stays Stripe-metered, full
  deposit stands as slashable collateral.
- `src/app/api/toll/v6/bonds/slash/route.ts` — slash sends the slashed
  amount to evidence `pay_to` (must be a Base address) or
  `TOLL_RECOURSE_WALLET`; deterministic idempotency key per
  (bond, remaining-before, remaining-after); refuses mock-era bonds.
- `src/lib/toll-schemas.ts` — new request shapes published on
  `GET /api/toll/schema`, incl. the escrow/bond deposit wallet addresses.

Law notes: the 1% escrow fee is realized at release (99/1 split); a refund
returns 100% with no fee. Timeout/dispute sweep routes still need the same
treatment (follow-up).

## Sepolia e2e (in progress, 2026-09-30)

Corey's order: Base Sepolia end-to-end BEFORE any mainnet movement.

- AwLPay now has a fully separate testnet toll path: `TOLL_TESTNET_SEPOLIA=1`
  selects chain 84532 + Circle testnet USDC
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e` + separate keys
  (`TOLL_TESTNET_ESCROW_KEY`/`_BONDS_KEY`), wallets
  (`TOLL_TESTNET_ESCROW_WALLET`/`_BONDS_WALLET`), state/ledger files.
  `broadcast_toll_testnet()` refuses the mainnet config and vice versa;
  the mainnet guard is untouched.
- Both endpoints accept `"network": "sepolia"` (default `"mainnet"`);
  unknown networks are refused.
- Verified Sepolia facts: chain 84532 live at `https://sepolia.base.org`,
  testnet USDC confirmed on-chain (6 decimals, "USDC"). Faucets: Circle
  (https://faucet.circle.com, no account) for USDC; Coinbase CDP / Alchemy /
  QuickNode / Ponzifun for Sepolia ETH.
- Watch: unconfirmed community claim that Ethereum Sepolia (L1) retires
  ~Sept 30, 2026 — fine for a days-long test, keep an eye on it.
- AwLPay tests: 148 passed, incl. 9 new testnet-path tests (flag refusal,
  cross-network refusal, state isolation).

Each outbound call enforces: per-tx cap (default 1,000 USDC), daily cap,
idempotency key (no double-send), append-only outbound transfer log,
separate keys (`TOLL_ESCROW_KEY`, `TOLL_BONDS_KEY`), refusal of arbitrary
contract calls / tokens / chains.

**Unresolved:** `EvmAdapter.broadcast()` still calls `broadcast_allowed()`
→ `assert_testnet()` which refuses Base mainnet. Do NOT weaken the generic
guard. Build a dedicated `broadcast_toll_mainnet()` path instead.

## 4. New data contract (Gate 3 — `toll_escrows`)

Add columns:
- `deposit_tx_hash TEXT` — the real on-chain deposit tx (unique, replay key)
- `payer_wallet TEXT` — depositor's Base address (bound at verify time)
- `payout_wallet TEXT` — agent's Base address (required at lock)
- `confirmed_uusdc BIGINT` — verified on-chain amount (source of truth)
- `release_tx_hash TEXT` — outbound release tx (nullable until released)
- `refund_tx_hash TEXT` — outbound refund tx (nullable until refunded)
- `chain_id INTEGER DEFAULT 8453`, `token_contract TEXT` (canonical USDC)

New table `toll_chain_transfers` (append-only outbound log):
- `id BIGSERIAL PK`, `kind` (release/refund/slash), `ref_id`,
  `tx_hash UNIQUE`, `from_wallet`, `to_wallet`, `amount_uusdc`,
  `idempotency_key UNIQUE`, `status` (signed/broadcast/confirmed/failed),
  `created_at`, `confirmed_at`.

## 5. New data contract (Gate 6 — `toll_bonds`)

Add columns:
- `deposit_tx_hash TEXT` (unique, replay key)
- `staker_wallet TEXT`
- `payout_wallet TEXT` — where release/refund goes
- `confirmed_uusdc BIGINT`
- `release_tx_hash TEXT`, `slash_tx_hash TEXT` (nullable)

`toll_bond_events` gains `tx_hash TEXT` for the on-chain leg of each event.

## 6. Real flows

### Gate 3 lock (replaces mock lock)
1. Payer sends real Base USDC to the dedicated escrow wallet, then calls
   `POST /api/toll/v3/escrow` with `{agent_id, job_id, job_spec_hash,
   amount_uusdc, timeout_sec, deposit_tx_hash, payout_wallet}`.
2. Rider calls AwLPay `deposit/verify`: chain 8453 ✓, canonical USDC ✓,
   receipt success ✓, recipient = escrow wallet ✓, Transfer sum ≥
   amount_uusdc ✓, payer binding ✓, tx not seen before ✓.
3. Record escrow with real deposit data. 1% fee is accounted (still metered
   to Stripe as today); the fee is realized when funds move.
4. Return the signed envelope + receipt as today, with real `lock_tx`.

### Gate 3 release / refund
- Release: on valid delivery receipt (unchanged verification), Rider calls
  AwLPay `escrow/release` → 99% to `payout_wallet`. Store `release_tx_hash`.
  Keep the `.eq("status","locked")` single-flip guard.
- Refund (timeout/dispute): AwLPay `escrow/refund` → 100% to `payer_wallet`.
  Timeout/dispute law must be explicit before this ships.

### Gate 6 stake
1. Agent sends real Base USDC to the dedicated bond wallet, calls stake with
   `{agent_id, amount_uusdc, conditions[], deposit_tx_hash, payout_wallet}`.
2. Same deposit verification as Gate 3.
3. Bond record references the real tx. No `toll_mock_balances` writes.

### Gate 6 slash / release
- Slash only on valid signed evidence envelope + allowed trigger (unchanged
  logic). AwLPay `bonds/slash` sends proceeds to evidence `pay_to` or the
  recourse pool. 1% fee stays real and explicit.
- Release/refund per recorded condition via `bonds/release`.

## 7. Test order

1. Unit: receipt parsing, replay rejection, fee math, caps, idempotency.
2. Base Sepolia dry run through AwLPay's existing wallet machinery.
3. Full Rider → AwLPay integration test on testnet.
4. Exact Base mainnet transaction plan → Corey for explicit approval.

## 8. Approvals (Corey's standing rules)

- No mainnet tx, wallet funding, key placement, or charge without Corey
  seeing the exact plan and giving explicit per-charge approval.
- Dedicated escrow + bond wallets required — Corey's personal payout wallet
  is NOT a custodial toll wallet.
- Keys stored only with Corey's OK; never in chat, logs, or git.
- Ship holds deployment of 660e109 until the real-settlement commit lands —
  public copy must not claim real settlement while mock tables are written.
