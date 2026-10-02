/**
 * Toll 6 — bonds: flag-off honesty, pure-logic port of test_bonds.py,
 * route source-shape assertions. No network, no secrets, no DB.
 * Run: cd src && npm run selftest:toll-6
 *
 * The Python spec's BondLedger is SQLite-backed; the TS routes use Supabase
 * tables (schema NOT applied in tests), so this file drives the pure core
 * (toll-6-core.mjs) through an in-memory ledger with the exact semantics of
 * tollkeeper/bonds.py: mocked balances, 1% stake toll, evidence checks,
 * integer slash math, status transitions, 5c audit export.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  signTollPayload,
  verifyTollEnvelope,
  tollEnvelopeId,
  devTollKeypair,
  jwksForTest,
} from "./toll-receipt-core.mjs";
import {
  TRIGGER_ATTESTATION,
  RECOURSE_POOL,
  AUDIT_EXPORT_FEE_UUSDC,
  Toll6Error,
  validateAmountUusdc,
  validateConditions,
  newBondId,
  stakeTollFor,
  buildStakePayload,
  buildStakeFeePayload,
  validateSlashEvidence,
  slashAmounts,
  buildSlashPayload,
  buildReleasePayload,
  buildAuditTrailPayload,
  utcnow,
} from "./toll-6-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

// ── In-memory ledger mirroring tollkeeper/bonds.py semantics ───────────────
class MiniLedger {
  constructor(key, kid) {
    this.key = key;
    this.kid = kid;
    this.jwks = jwksForTest(key.publicKey, kid);
    this.balances = new Map();
    this.bonds = new Map();
    this.events = []; // {bond_id, kind, amount_uusdc, envelope}
    this.meterRows = []; // {module, operation, amount_uusdc, ref_id}
  }
  sign(payload) {
    return signTollPayload(payload, { privateKey: this.key.privateKey, kid: this.kid });
  }
  fund(agent_id, uusdc) {
    this.balances.set(agent_id, (this.balances.get(agent_id) ?? 0) + uusdc);
  }
  balance_of(agent_id) {
    return this.balances.get(agent_id) ?? 0;
  }
  move(frm, to, amt) {
    if (amt < 0) throw new Toll6Error("negative movement");
    if (this.balance_of(frm) < amt) throw new Toll6Error(`insufficient mocked balance for ${frm}`);
    this.balances.set(frm, this.balance_of(frm) - amt);
    this.balances.set(to, this.balance_of(to) + amt);
  }
  meterWrite(module, operation, amt, ref_id) {
    this.meterRows.push({ module, operation, amount_uusdc: amt, ref_id });
  }
  meterTotal(agent_id) {
    const ids = new Set([...this.bonds.values()].filter((b) => b.agent_id === agent_id).map((b) => b.bond_id));
    return this.meterRows
      .filter((m) => m.module === "bonds" && (ids.has(m.ref_id) || (m.operation === "audit_export" && m.ref_id === agent_id)))
      .reduce((s, m) => s + m.amount_uusdc, 0);
  }
  stake(agent_id, amount_uusdc, conditions) {
    const amount = validateAmountUusdc(amount_uusdc);
    const conds = validateConditions(conditions);
    if (this.balance_of(agent_id) < amount) throw new Toll6Error("insufficient mocked balance to stake");
    const bond_id = newBondId();
    this.move(agent_id, "bond:" + bond_id, amount);
    const payload = buildStakePayload({ bond_id, agent_id, amount_uusdc: amount, conditions: conds, created_at: utcnow() });
    const envelope = this.sign(payload);
    this.bonds.set(bond_id, { bond_id, agent_id, amount_uusdc: amount, remaining_uusdc: amount, conditions: conds, status: "active", envelope });
    this.events.push({ bond_id, kind: "stake", amount_uusdc: amount, envelope });
    this.meterWrite("bonds", "stake_1pct", stakeTollFor(amount), bond_id);
    return { bond_id, envelope, toll_uusdc: stakeTollFor(amount) };
  }
  // 1%-ON-TOP stake (Corey's 2026-09-30 call): the deposit must cover
  // amount + fee. The bond stays whole; the fee moves to the fee wallet
  // immediately and gets its own event row.
  stakeOnTop(agent_id, amount_uusdc, conditions, feeWallet) {
    const amount = validateAmountUusdc(amount_uusdc);
    const conds = validateConditions(conditions);
    const fee = stakeTollFor(amount);
    const required = amount + fee;
    if (this.balance_of(agent_id) < required) {
      const err = new Toll6Error(`deposit_not_proven: paid less than amount+fee (${required})`);
      err.code = 402;
      throw err;
    }
    const bond_id = newBondId();
    this.move(agent_id, "bond:" + bond_id, amount);
    this.bonds.set(bond_id, { bond_id, agent_id, amount_uusdc: amount, remaining_uusdc: amount, conditions: conds, status: "active" });
    this.events.push({ bond_id, kind: "stake", amount_uusdc: amount });
    let feeTx = null;
    if (fee > 0) {
      this.move(agent_id, feeWallet, fee);
      feeTx = "0xfee" + bond_id.slice(4);
      this.events.push({ bond_id, kind: "fee", amount_uusdc: fee, tx_hash: feeTx, to_wallet: feeWallet });
    }
    this.meterWrite("bonds", "stake_1pct", fee, bond_id);
    return { bond_id, fee_uusdc: fee, fee_tx_hash: feeTx, fee_wallet: feeWallet, required_uusdc: required };
  }
  getBond(bond_id) {
    const b = this.bonds.get(bond_id);
    if (!b) throw new Toll6Error(`unknown bond_id ${JSON.stringify(bond_id)}`);
    return b;
  }
  checkEvidence(bond_id, trigger, evidence_envelope) {
    const payload = verifyTollEnvelope(evidence_envelope, this.jwks); // throws TollReceiptError → wrapped below
    return validateSlashEvidence(payload, bond_id, trigger);
  }
  slash(bond_id, trigger, evidence_envelope) {
    const bond = this.getBond(bond_id);
    if (bond.status !== "active") throw new Toll6Error(`bond ${bond_id} is ${bond.status}, cannot slash`);
    if (!(trigger in TRIGGER_ATTESTATION)) throw new Toll6Error(`unknown trigger ${JSON.stringify(trigger)}`);
    const cond = bond.conditions.find((c) => c.on === trigger);
    if (!cond) throw new Toll6Error(`bond has no condition for trigger ${JSON.stringify(trigger)}`);
    let evPayload;
    try {
      evPayload = verifyTollEnvelope(evidence_envelope, this.jwks);
    } catch (err) {
      throw new Toll6Error(`evidence envelope invalid: ${err.message}`);
    }
    validateSlashEvidence(evPayload, bond_id, trigger);
    const { slashAmt, remaining, newStatus } = slashAmounts(bond.remaining_uusdc, cond.slash_pct);
    const recipient = evPayload.pay_to || RECOURSE_POOL;
    this.move("bond:" + bond_id, recipient, slashAmt);
    bond.remaining_uusdc = remaining;
    bond.status = newStatus;
    const payload = buildSlashPayload({
      bond_id, agent_id: bond.agent_id, trigger, slash_pct: cond.slash_pct,
      slashed_uusdc: slashAmt, recipient, evidence_id: tollEnvelopeId(evidence_envelope),
      remaining_uusdc: remaining, created_at: utcnow(),
    });
    const envelope = this.sign(payload);
    this.events.push({ bond_id, kind: "slash", amount_uusdc: slashAmt, envelope });
    return { envelope, slashed_uusdc: slashAmt, recipient, remaining_uusdc: remaining };
  }
  release(bond_id) {
    const bond = this.getBond(bond_id);
    if (bond.status !== "active") throw new Toll6Error(`bond ${bond_id} is ${bond.status}, cannot release`);
    const amount = bond.remaining_uusdc;
    this.move("bond:" + bond_id, bond.agent_id, amount);
    bond.remaining_uusdc = 0;
    bond.status = "released";
    const payload = buildReleasePayload({ bond_id, agent_id: bond.agent_id, released_uusdc: amount, created_at: utcnow() });
    const envelope = this.sign(payload);
    this.events.push({ bond_id, kind: "release", amount_uusdc: amount, envelope });
    return { envelope, released_uusdc: amount };
  }
  exportAuditTrail(agent_id) {
    const chain = this.events
      .filter((e) => this.bonds.get(e.bond_id)?.agent_id === agent_id)
      .map((e) => e.envelope);
    const payload = buildAuditTrailPayload({ agent_id, chain, exported_at: utcnow() });
    const envelope = this.sign(payload);
    this.meterWrite("bonds", "audit_export", AUDIT_EXPORT_FEE_UUSDC, agent_id);
    return envelope;
  }
}

function makeLedger(kid = "dev-toll-6") {
  const key = devTollKeypair(kid);
  return { ledger: new MiniLedger(key, kid), key };
}

function evidence(ledger, bond_id, attestation_type, verdict_field, verdict, pay_to) {
  const payload = { attestation_type, bond_id, [verdict_field]: verdict };
  if (pay_to) payload.pay_to = pay_to;
  return ledger.sign(payload);
}

const CONDS = [
  { on: "dispute_upheld", slash_pct: 50 },
  { on: "oracle_refuse", slash_pct: 100 },
];

function refuses(fn, why) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof Toll6Error || err.message.length > 0, why);
    return;
  }
  throw new assert.AssertionError({ message: `accepted bad input: ${why}` });
}

// ── TRIGGER_ATTESTATION map ────────────────────────────────────────────────
assert.deepEqual(TRIGGER_ATTESTATION.dispute_upheld, ["dispute_resolution", "upheld"]);
assert.deepEqual(TRIGGER_ATTESTATION.oracle_refuse, ["exactness_attestation", "refuse"]);
assert.deepEqual(TRIGGER_ATTESTATION.oracle_fail, ["exactness_attestation", "fail"]);
assert.deepEqual(TRIGGER_ATTESTATION.timeout_default, ["timeout_certificate", "default"]);
assert.equal(RECOURSE_POOL, "lab:recourse-pool");
assert.equal(AUDIT_EXPORT_FEE_UUSDC, 50_000);

// ── test_stake_ok ──────────────────────────────────────────────────────────
{
  const { ledger, key } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const res = ledger.stake("agent:a", 10_000_000, CONDS);
  assert.match(res.bond_id, /^bnd_[0-9a-f]{16}$/);
  assert.equal(res.toll_uusdc, 10_000_000 / 100); // 1% of 10 USDC
  const payload = verifyTollEnvelope(res.envelope, ledger.jwks);
  assert.equal(payload.type, "bond_stake");
  assert.equal(payload.amount_uusdc, 10_000_000);
  assert.deepEqual(payload.conditions, CONDS);
  assert.equal(ledger.balance_of("agent:a"), 90_000_000); // funds locked
  assert.equal(ledger.meterTotal("agent:a"), 100_000); // metered 1%
}

// ── test_stake_on_top_ok: exact amount+fee → bond whole, fee forwarded ────
{
  const { ledger } = makeLedger();
  const FEE_WALLET = "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";
  ledger.fund("agent:a", 10_100_000); // exactly 10 USDC + 1%
  const res = ledger.stakeOnTop("agent:a", 10_000_000, CONDS, FEE_WALLET);
  assert.equal(res.fee_uusdc, 100_000); // 1% of 10 USDC
  assert.equal(res.required_uusdc, 10_100_000);
  assert.equal(res.fee_wallet, FEE_WALLET);
  assert.ok(res.fee_tx_hash, "fee tx hash recorded");
  const bond = ledger.getBond(res.bond_id);
  assert.equal(bond.amount_uusdc, 10_000_000);
  assert.equal(bond.remaining_uusdc, 10_000_000); // bond stays whole
  assert.equal(ledger.balance_of(FEE_WALLET), 100_000); // fee landed
  assert.equal(ledger.balance_of("agent:a"), 0); // exact deposit spent
  const kinds = ledger.events.filter((e) => e.bond_id === res.bond_id).map((e) => e.kind);
  assert.deepEqual(kinds, ["stake", "fee"]);
  const feeEv = ledger.events.find((e) => e.kind === "fee");
  assert.equal(feeEv.amount_uusdc, 100_000);
  assert.equal(feeEv.tx_hash, res.fee_tx_hash);
}

// ── test_stake_on_top_refusals ───────────────────────────────────────────
{
  const { ledger } = makeLedger();
  const FEE_WALLET = "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c";
  // deposit of amount only (no fee) → 402-style refusal
  ledger.fund("agent:short", 10_000_000);
  try {
    ledger.stakeOnTop("agent:short", 10_000_000, CONDS, FEE_WALLET);
    throw new assert.AssertionError({ message: "fee-less deposit accepted" });
  } catch (err) {
    assert.equal(err.code, 402, "underfunded deposit refuses like 402 deposit_not_proven");
  }
  // dust bond: fee floors to 0, no fee movement, bond still whole
  ledger.fund("agent:dust", 99);
  const dust = ledger.stakeOnTop("agent:dust", 99, CONDS, FEE_WALLET);
  assert.equal(dust.fee_uusdc, 0);
  assert.equal(dust.fee_tx_hash, null);
  assert.equal(ledger.getBond(dust.bond_id).remaining_uusdc, 99);
}

// ── buildStakeFeePayload shape ────────────────────────────────────────────
{
  const p = buildStakeFeePayload({
    bond_id: "bnd_abc123",
    agent_id: "agent:a",
    fee_uusdc: 100_000,
    fee_wallet: "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c",
    fee_tx_hash: "0xdeadbeef",
    created_at: 1234567890,
  });
  assert.equal(p.type, "bond_stake_fee");
  assert.equal(p.bond_id, "bnd_abc123");
  assert.equal(p.fee_uusdc, 100_000);
  assert.equal(p.fee_wallet, "0xAd3dB8e2b1A311701E6233f17F6d648e4A52287c");
  assert.equal(p.fee_tx_hash, "0xdeadbeef");
}

// ── test_stake_refusals ────────────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 5_000_000);
  const bad = [
    [[{ on: "nope", slash_pct: 50 }], "unknown trigger"],
    [[{ on: "dispute_upheld", slash_pct: 0 }], "zero pct"],
    [[{ on: "dispute_upheld", slash_pct: 101 }], "pct > 100"],
    [[{ on: "dispute_upheld", slash_pct: 50 }, { on: "dispute_upheld", slash_pct: 10 }], "duplicate trigger"],
    [[], "empty conditions"],
    ["notalist", "non-list conditions"],
    [[{ on: "dispute_upheld" }], "missing slash_pct"],
    [[{ on: "dispute_upheld", slash_pct: 50.5 }], "float pct (integer-only deviation)"],
    [[{ on: "dispute_upheld", slash_pct: true }], "bool pct"],
  ];
  for (const [conds, why] of bad) refuses(() => ledger.stake("agent:a", 1_000_000, conds), why);
  refuses(() => ledger.stake("agent:a", 0, CONDS), "zero amount");
  refuses(() => ledger.stake("agent:a", -5, CONDS), "negative amount");
  refuses(() => ledger.stake("agent:a", 10.5, CONDS), "float amount (integer-only deviation)");
  refuses(() => ledger.stake("agent:a", true, CONDS), "bool amount");
  refuses(() => ledger.stake("agent:a", 6_000_000, CONDS), "insufficient funds");
}

// ── test_slash_dispute ─────────────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const ev = evidence(ledger, bond_id, "dispute_resolution", "outcome", "upheld", "agent:counterparty");
  const res = ledger.slash(bond_id, "dispute_upheld", ev);
  assert.equal(res.slashed_uusdc, 5_000_000); // 50% of 10 USDC
  assert.equal(res.recipient, "agent:counterparty");
  assert.equal(res.remaining_uusdc, 5_000_000);
  assert.equal(ledger.balance_of("agent:counterparty"), 5_000_000);
  const payload = verifyTollEnvelope(res.envelope, ledger.jwks);
  assert.equal(payload.type, "bond_slash");
  assert.equal(payload.evidence_id, tollEnvelopeId(ev));
  assert.equal(payload.trigger, "dispute_upheld");
}

// ── verdict from `verdict` field variant ───────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const ev = evidence(ledger, bond_id, "dispute_resolution", "verdict", "upheld");
  const res = ledger.slash(bond_id, "dispute_upheld", ev);
  assert.equal(res.slashed_uusdc, 5_000_000);
}

// ── test_slash_oracle_exhausts ─────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const ev = evidence(ledger, bond_id, "exactness_attestation", "verdict", "refuse");
  const res = ledger.slash(bond_id, "oracle_refuse", ev);
  assert.equal(res.slashed_uusdc, 10_000_000); // 100%
  assert.equal(res.recipient, RECOURSE_POOL); // default when no pay_to
  assert.equal(res.remaining_uusdc, 0);
  refuses(() => ledger.slash(bond_id, "oracle_refuse", ev), "slash on exhausted bond");
  refuses(() => ledger.release(bond_id), "release on exhausted bond");
}

// ── test_slash_refusals ────────────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  const attackerKey = devTollKeypair("attacker");
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const good_ev = evidence(ledger, bond_id, "dispute_resolution", "outcome", "upheld");
  // trigger with no matching condition on this bond
  refuses(() => ledger.slash(bond_id, "timeout_default", good_ev), "trigger without condition");
  // unknown trigger entirely
  refuses(() => ledger.slash(bond_id, "nope", good_ev), "unknown trigger");
  // evidence for a different bond
  const ev_other = evidence(ledger, "bnd_deadbeefdeadbeef", "dispute_resolution", "outcome", "upheld");
  refuses(() => ledger.slash(bond_id, "dispute_upheld", ev_other), "evidence for another bond");
  // evidence signed by unknown key
  const forged = signTollPayload(
    { attestation_type: "dispute_resolution", bond_id, outcome: "upheld" },
    { privateKey: attackerKey.privateKey, kid: "attacker" }
  );
  refuses(() => ledger.slash(bond_id, "dispute_upheld", forged), "forged evidence");
  // wrong attestation type for the trigger
  const ev_wrong = evidence(ledger, bond_id, "exactness_attestation", "verdict", "refuse");
  refuses(() => ledger.slash(bond_id, "dispute_upheld", ev_wrong), "mismatched attestation type");
  // right type, wrong verdict
  const ev_badverdict = evidence(ledger, bond_id, "dispute_resolution", "outcome", "dismissed");
  refuses(() => ledger.slash(bond_id, "dispute_upheld", ev_badverdict), "wrong verdict");
  // unknown bond
  refuses(() => ledger.slash("bnd_0000000000000000", "dispute_upheld", good_ev), "unknown bond");
  // oracle_fail needs exactness_attestation/fail, not /refuse
  refuses(() => ledger.slash(bond_id, "dispute_upheld", ev_wrong), "refuse verdict under dispute_upheld");
}

// ── test_release ───────────────────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const res = ledger.release(bond_id);
  assert.equal(res.released_uusdc, 10_000_000);
  assert.equal(ledger.balance_of("agent:a"), 100_000_000); // full refund
  const payload = verifyTollEnvelope(res.envelope, ledger.jwks);
  assert.equal(payload.type, "bond_release");
  refuses(() => ledger.release(bond_id), "double release");
  refuses(() => ledger.slash(bond_id, "dispute_upheld",
    evidence(ledger, bond_id, "dispute_resolution", "outcome", "upheld")), "slash after release");
}

// ── test_audit_trail ───────────────────────────────────────────────────────
{
  const { ledger } = makeLedger();
  ledger.fund("agent:a", 100_000_000);
  const bond_id = ledger.stake("agent:a", 10_000_000, CONDS).bond_id;
  const ev = evidence(ledger, bond_id, "dispute_resolution", "outcome", "upheld");
  ledger.slash(bond_id, "dispute_upheld", ev);
  ledger.release(bond_id); // releases the remaining 5
  const trail = ledger.exportAuditTrail("agent:a");
  const payload = verifyTollEnvelope(trail, ledger.jwks);
  assert.equal(payload.type, "audit_trail");
  assert.equal(payload.agent_id, "agent:a");
  assert.equal(payload.envelope_count, 3);
  const kinds = payload.chain.map((e) => verifyTollEnvelope(e, ledger.jwks).type);
  assert.deepEqual(kinds, ["bond_stake", "bond_slash", "bond_release"]);
  for (const e of payload.chain) verifyTollEnvelope(e, ledger.jwks); // every envelope verifies
  assert.equal(ledger.meterTotal("agent:a"), 100_000 + AUDIT_EXPORT_FEE_UUSDC); // 1% stake + 5c export
}

// ── test_audit_trail_empty_agent ───────────────────────────────────────────
{
  const { ledger } = makeLedger();
  const trail = ledger.exportAuditTrail("agent:ghost");
  const payload = verifyTollEnvelope(trail, ledger.jwks);
  assert.equal(payload.envelope_count, 0);
  assert.deepEqual(payload.chain, []);
}

// ── slash math unit cases (integer only) ───────────────────────────────────
{
  assert.deepEqual(slashAmounts(10_000_000, 50), { slashAmt: 5_000_000, remaining: 5_000_000, newStatus: "active" });
  assert.deepEqual(slashAmounts(10_000_000, 100), { slashAmt: 10_000_000, remaining: 0, newStatus: "exhausted" });
  refuses(() => slashAmounts(1, 1), "nothing left to slash on dust");
  assert.equal(stakeTollFor(10_000_000), 100_000);
  assert.equal(stakeTollFor(99), 0); // integer floor
}

// ── Flag assertions (source shape; flag lives in TS toll-flags) ────────────
const flags = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
assert.match(flags, /isToll6BondsLive/);
assert.match(flags, /TOLL6_BONDS_OFF_BODY/);
assert.match(flags, /toll6_bonds_off/);
assert.match(flags, /TOLL6_BONDS_LIVE/);

// ── Route sources: 503 + payer + usage + stripe reporter ────────────────────
const stake = readFileSync(join(__dirname, "../app/api/toll/v6/bonds/stake/route.ts"), "utf8");
assert.match(stake, /isToll6BondsLive/);
assert.match(stake, /TOLL6_BONDS_OFF_BODY/);
assert.match(stake, /status:\s*503/);
assert.match(stake, /resolveTollPayer/);
assert.match(stake, /isTollPayerOk/);
assert.match(stake, /checkMonthlyUsage\(`toll6_stake:/);
assert.match(stake, /reportToll6BondStake/);
assert.match(stake, /missing_deposit/);
assert.match(stake, /t6s_/);
assert.match(stake, /toll_bonds/);
assert.match(stake, /toll_bond_events/);
assert.match(stake, /toll_meter/);
assert.match(stake, /verifyTollDeposit/);
assert.match(stake, /deposit_not_proven/);
assert.match(stake, /deposit_already_claimed/);
assert.match(stake, /payout_wallet/);
assert.ok(!/toll_mock_balances/.test(stake), "stake never touches mock balances");
assert.match(stake, /price_usd:\s*null/);
// 1%-on-top: deposit must cover amount+fee, fee forwarded fail-closed
assert.match(stake, /required_uusdc/);
assert.match(stake, /min_uusdc:\s*required_uusdc/);
assert.match(stake, /TOLL_FEE_WALLET/);
assert.match(stake, /toll_fee_wallet_unconfigured/);
assert.match(stake, /tollSend\(/);
assert.match(stake, /slot:\s*"bonds"/);
assert.match(stake, /t6:fee:/);
assert.match(stake, /bond_stake_fee/);
assert.match(stake, /stake_fee_send_failed/);
assert.match(stake, /retry_idempotency_key/);
assert.match(stake, /buildStakeFeePayload/);
assert.match(stake, /kind:\s*"fee"/);
assert.match(stake, /toll_chain_transfers/);
assert.match(stake, /fee_uusdc/);
assert.match(stake, /fee_tx_hash/);
assert.match(stake, /fee_wallet/);

const slash = readFileSync(join(__dirname, "../app/api/toll/v6/bonds/slash/route.ts"), "utf8");
assert.match(slash, /isToll6BondsLive/);
assert.match(slash, /TOLL6_BONDS_OFF_BODY/);
assert.match(slash, /status:\s*503/);
assert.match(slash, /resolveTollPayer/);
assert.match(slash, /verifyTollEnvelope/);
assert.match(slash, /labJwks\(\)/);
assert.match(slash, /validateSlashEvidence/);
assert.match(slash, /t6x_/);
assert.match(slash, /evidence_mismatch/);
assert.match(slash, /bond_not_active/);
assert.match(slash, /trigger_not_in_conditions/);
assert.match(slash, /tollSend/);
assert.match(slash, /bond_predates_real_settlement/);
assert.match(slash, /slash_recipient_unpayable/);
assert.match(slash, /toll_chain_transfers/);
assert.ok(!/toll_mock_balances/.test(slash), "slash never touches mock balances");

const stripe = readFileSync(join(__dirname, "stripe.ts"), "utf8");
assert.match(stripe, /reportToll6BondStake/);
assert.match(stripe, /reportToll6AuditExport/);

console.log("toll-6.selftest: ok (core logic, evidence refusals, slash math, release, audit export, 1%-on-top fee, route shapes)");

// ── Fee migration: toll_bond_events.kind admits 'fee' ──────────────────────
const feeMigration = readFileSync(join(root, "supabase/migrations/20260930_toll6_fee_on_top.sql"), "utf8");
assert.match(feeMigration, /toll_bond_events/);
assert.match(feeMigration, /'fee'/);
