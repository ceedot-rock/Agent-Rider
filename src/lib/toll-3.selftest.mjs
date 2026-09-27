/**
 * Toll 3 — escrow / billing. Port of ~/workspace/rider-toll/tollkeeper/test_billing.py
 * against src/lib/toll-3-core.mjs (pure builders) + toll-receipt-core.mjs
 * (ephemeral devTollKeypair / jwksForTest signing). No network, no secrets,
 * no DB. Run: cd src && npm run selftest:toll-3
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BudgetExhaustedError,
  DisputeError,
  DISPUTE_FEE_UUSDC,
  ESCROW_FEE_BPS,
  LAB_FEES_ACCT,
  MICRO,
  Toll3Error,
  WINDOWS,
  authorizeBudget,
  buildDisputeOpen,
  buildDisputeResolve,
  buildDisputeRespond,
  buildEscrowLockPayload,
  buildEscrowReleasedPayload,
  buildPaymentReceiptPayload,
  escrowAcct,
  escrowFeeFor,
  makeMockTxHasher,
  mockTxHash,
  planTimeoutRefund,
  selectActiveBudget,
  settleOnchain,
  validateAmountUusdc,
  validateBudget,
  validateRelease,
} from "./toll-3-core.mjs";
import {
  devTollKeypair,
  jwksForTest,
  signTollPayload,
  verifyTollEnvelope,
} from "./toll-receipt-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let N = 0;
function ok(cond, msg) {
  N += 1;
  assert.ok(cond, msg);
}
function eq(a, b, msg) {
  N += 1;
  assert.equal(a, b, msg);
}
function throws(fn, cls, msg) {
  N += 1;
  assert.throws(fn, cls, msg);
}

// Ephemeral lab-style key for envelope roundtrips.
const { privateKey, publicKey, kid } = devTollKeypair("dev-toll-3");
const jwks = jwksForTest(publicKey, kid);
function seal(payload) {
  return signTollPayload(payload, { privateKey, kid });
}
function open(env) {
  return verifyTollEnvelope(env, jwks);
}

// ── Money consts ───────────────────────────────────────────────────────────
eq(MICRO, 1_000_000, "MICRO");
eq(DISPUTE_FEE_UUSDC, 50_000, "dispute fee 5c");
eq(ESCROW_FEE_BPS, 100, "1% routing fee");
eq(LAB_FEES_ACCT, "lab:fees", "lab fees account");
eq(WINDOWS.daily, 86400, "windows daily");
eq(WINDOWS.weekly, 604800, "windows weekly");
eq(WINDOWS.monthly, 2592000, "windows monthly");
eq(WINDOWS.job, null, "windows job");

// ── Flag OFF default + ON spellings (source-shape; flag logic lives in TS) ─
const flagsSrc = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
ok(/function envFlagOn/.test(flagsSrc), "envFlagOn helper present");
ok(
  /return v === "1" \|\| v === "true"/.test(flagsSrc),
  'flag flips only on "1"/"true" (everything else incl. empty/0 stays OFF)'
);
ok(/export function isToll3EscrowLive\(\): boolean \{\s*return envFlagOn\("TOLL3_ESCROW_LIVE"\);/.test(flagsSrc), "isToll3EscrowLive reads TOLL3_ESCROW_LIVE, default OFF");
ok(/toll3_escrow_off/.test(flagsSrc), "TOLL3_ESCROW_OFF_BODY error code");
ok(/meter\/report|TOLL3_ESCROW_LIVE=1 only after/.test(flagsSrc), "off-body carries the smoke hint");

// ── Route source-shape assertions ──────────────────────────────────────────
const lockSrc = readFileSync(join(__dirname, "../app/api/toll/v3/escrow/route.ts"), "utf8");
ok(/isToll3EscrowLive/.test(lockSrc), "lock route checks isToll3EscrowLive");
ok(/TOLL3_ESCROW_OFF_BODY/.test(lockSrc), "lock route returns OFF body");
ok(/status:\s*503/.test(lockSrc), "lock route 503 when off");
ok(/resolveTollPayer/.test(lockSrc), "lock route reuses resolveTollPayer");
ok(/isTollPayerOk/.test(lockSrc), "lock route reuses isTollPayerOk");
ok(/checkMonthlyUsage/.test(lockSrc), "lock route reuses checkMonthlyUsage");
ok(/reportToll3Escrow/.test(lockSrc), "lock route reports toll3 meter");
ok(/toll_escrows/.test(lockSrc), "lock route writes toll_escrows");
ok(/toll_mock_ledger/.test(lockSrc), "lock route writes toll_mock_ledger");
ok(/toll_meter/.test(lockSrc), "lock route writes toll_meter");
ok(/toll_store_unavailable/.test(lockSrc), "lock route fails closed on store errors");
ok(/price_usd:\s*null/.test(lockSrc), "lock route price_usd null (variable 1% fee)");
ok(/`t3_\$\{/.test(lockSrc) || /t3_/.test(lockSrc), "lock route receipt_id t3_ prefix");
ok(/Access-Control-Allow-Origin/.test(lockSrc) && /OPTIONS/.test(lockSrc), "lock route CORS + OPTIONS");

const relSrc = readFileSync(join(__dirname, "../app/api/toll/v3/escrow/release/route.ts"), "utf8");
ok(/isToll3EscrowLive/.test(relSrc), "release route checks isToll3EscrowLive");
ok(/TOLL3_ESCROW_OFF_BODY/.test(relSrc), "release route returns OFF body");
ok(/status:\s*503/.test(relSrc), "release route 503 when off");
ok(/resolveTollPayer/.test(relSrc), "release route reuses resolveTollPayer");
ok(/verifyTollEnvelope/.test(relSrc), "release route verifies receipt envelope");
ok(/labJwks/.test(relSrc), "release route verifies against lab JWKS");
ok(/bad_delivery_receipt/.test(relSrc), "release route 400s bad receipts fail-closed");
ok(/release_refused/.test(relSrc), "release route 402s refused releases");
ok(/escrow_released|buildEscrowReleasedPayload/.test(relSrc), "release route seals escrow_released");

// ── No float money ops in core source ──────────────────────────────────────
const coreSrc = readFileSync(join(__dirname, "toll-3-core.mjs"), "utf8");
const codeOnly = coreSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "");
ok(!/\d\.\d+/.test(codeOnly), "no decimal literals in core money code");
ok(!/parseFloat|Number\(.*\)\s*\/|toFixed/.test(codeOnly), "no float coercion in core");
ok(/Math\.floor\(\(amount_uusdc \* ESCROW_FEE_BPS\) \/ 10000\)/.test(codeOnly), "fee is integer floor division");

// ── Amounts ────────────────────────────────────────────────────────────────
eq(validateAmountUusdc(1), 1, "min amount ok");
throws(() => validateAmountUusdc(0), Toll3Error, "reject 0");
throws(() => validateAmountUusdc(-5), Toll3Error, "reject negative");
throws(() => validateAmountUusdc(1.5), Toll3Error, "reject float");
throws(() => validateAmountUusdc("100"), Toll3Error, "reject string");
throws(() => validateAmountUusdc(true), Toll3Error, "reject bool");
throws(() => validateAmountUusdc(NaN), Toll3Error, "reject NaN");

eq(escrowFeeFor(2_000_000).fee, 20_000, "1% fee");
eq(escrowFeeFor(2_000_000).net, 1_980_000, "fee net");
eq(escrowFeeFor(1_000_001).fee, 10_000, "fee truncates to integer");
eq(escrowFeeFor(1_000_001).net, 990_001, "truncated fee net");
throws(() => escrowFeeFor(0), Toll3Error, "fee rejects 0");

// ── Mock tx hashes ─────────────────────────────────────────────────────────
const hasher = makeMockTxHasher();
const tx1 = hasher("alice", "bob", 1_500_000, "test", 1000);
ok(tx1.startsWith("mock_"), "mock_ prefix");
eq(tx1.length, 5 + 64, "mock_ + sha256 hex");
const tx1b = hasher("alice", "bob", 1_500_000, "test", 1000);
ok(tx1 !== tx1b, "nonce keeps repeated transfers unique");
eq(
  mockTxHash("a", "b", 1, "m", 2, 3),
  "mock_" + (await import("node:crypto")).createHash("sha256").update("a|b|1|m|2|3", "utf8").digest("hex"),
  "preimage format mirrors Python"
);
for (const badAmt of [0, -5, 1.5, "100"]) {
  throws(() => mockTxHash("a", "b", badAmt, "m", 1, 1), Toll3Error, `reject amount ${badAmt}`);
}

// ── Payment receipts ───────────────────────────────────────────────────────
const tx = { tx_hash: tx1, sender: "alice", recipient: "bob", amount_uusdc: 2_000_000 };
const receiptPayload = buildPaymentReceiptPayload(tx, 1001);
eq(receiptPayload.type, "payment_receipt", "receipt type");
eq(receiptPayload.tx_hash, tx1, "receipt tx_hash");
eq(receiptPayload.amount_uusdc, 2_000_000, "receipt amount");
const receiptEnv = seal(receiptPayload);
const receiptBack = open(receiptEnv);
ok(receiptBack.type === "payment_receipt" && receiptBack.amount_uusdc === 2_000_000, "receipt envelope verifies");
throws(() => buildPaymentReceiptPayload(null, 1), Toll3Error, "receipt for unknown tx");

// ── settle_onchain is a stub ───────────────────────────────────────────────
throws(() => settleOnchain(), Error, "settle_onchain refuses");
ok(/stub/i.test((() => { try { settleOnchain(); } catch (e) { return e.message; } })()), "stub message");

// ── Budgets: authorize + exhaust ───────────────────────────────────────────
const now = 1_700_000_000;
function budgetRow(over = {}) {
  return {
    id: 1, agent_id: "agent1", cap_uusdc: 10_000_000, spent_uusdc: 0,
    window: "monthly", window_start: now, categories: [], created_at: now, ...over,
  };
}
const sel1 = selectActiveBudget([budgetRow()], "default", now);
ok(sel1 !== null && sel1.rolled === false, "active budget selected");
const a1 = authorizeBudget(sel1.budget, 3_000_000, "agent1");
eq(a1.spent, 3_000_000, "spent after charge");
eq(a1.cap, 10_000_000, "cap echoed");
const a2 = authorizeBudget({ ...sel1.budget, spent_uusdc: 3_000_000 }, 7_000_000, "agent1");
eq(a2.spent, 10_000_000, "exactly at cap ok");
try {
  authorizeBudget({ ...sel1.budget, spent_uusdc: 10_000_000 }, 1, "agent1");
  assert.fail("over-cap charge authorized");
} catch (e) {
  ok(e instanceof BudgetExhaustedError, "BudgetExhaustedError");
  eq(e.http_status, 402, "402 status");
  eq(e.code, "BUDGET_EXHAUSTED", "code");
  const as402 = e.as402();
  eq(as402.status, 402, "as402 status");
  eq(as402.code, "BUDGET_EXHAUSTED", "as402 code");
  eq(as402.charge_uusdc, 1, "as402 charge");
}

// No budget → BudgetExhausted with cap 0
eq(selectActiveBudget([], "default", now), null, "no rows → null");
try {
  authorizeBudget(null, 100, "nobody");
  assert.fail("charge with no budget authorized");
} catch (e) {
  ok(e instanceof BudgetExhaustedError && e.cap === 0, "no-budget refusal cap 0");
}

// Categories
const catSel = selectActiveBudget([budgetRow({ agent_id: "agent2", cap_uusdc: 5_000_000, categories: ["compress"] })], "compress", now);
ok(catSel !== null, "matching category selected");
const catAuth = authorizeBudget(catSel.budget, 1_000_000, "agent2");
eq(catAuth.spent, 1_000_000, "category charge ok");
eq(selectActiveBudget([budgetRow({ categories: ["compress"] })], "other", now), null, "wrong category skipped");
try {
  authorizeBudget(null, 1_000_000, "agent2");
  assert.fail("wrong-category charge authorized");
} catch (e) {
  ok(e instanceof BudgetExhaustedError, "wrong-category → exhausted");
}

// Window rollover
const rolled = selectActiveBudget(
  [budgetRow({ agent_id: "agent3", cap_uusdc: 1_000_000, spent_uusdc: 1_000_000, window: "daily", window_start: now - 100_000 })],
  "default",
  now
);
ok(rolled !== null && rolled.rolled === true, "expired window rolls");
eq(rolled.budget.spent_uusdc, 0, "spent reset on roll");
eq(authorizeBudget(rolled.budget, 500_000, "agent3").spent, 500_000, "post-roll charge ok");

// Budget validation edges
throws(() => validateBudget({ agent_id: "a", cap_uusdc: 0 }), Toll3Error, "cap 0 rejected");
throws(() => validateBudget({ agent_id: "a", cap_uusdc: 1.5 }), Toll3Error, "float cap rejected");
throws(() => validateBudget({ agent_id: "a", cap_uusdc: 100, window: "yearly" }), Toll3Error, "unknown window rejected");
const vb = validateBudget({ agent_id: "a", cap_uusdc: 100 });
eq(vb.window, "monthly", "default window monthly");
eq(vb.window_secs, 2592000, "monthly secs");
const vj = validateBudget({ agent_id: "a", cap_uusdc: 100, window: "job" });
eq(vj.window_secs, null, "job window never rolls");
throws(() => authorizeBudget(budgetRow(), 0, "agent1"), Toll3Error, "authorize rejects 0");

// ── Escrow lock + release (full flow) ──────────────────────────────────────
function escrowRow(over = {}) {
  return { id: 7, job_id: "job-1", payer: "payer1", agent_id: "worker1", amount_uusdc: 2_000_000, fee_uusdc: 20_000, status: "locked", ...over };
}
const lock = buildEscrowLockPayload({
  escrow_id: 7, payer: "payer1", agent_id: "worker1", job_id: "job-1",
  amount_uusdc: 2_000_000, job_spec_hash: "spechash1", timeout_sec: 86400, created_at: now,
});
eq(lock.fee_uusdc, 20_000, "lock fee 1%");
eq(lock.net_uusdc, 1_980_000, "lock net");
eq(lock.payload.type, "escrow_locked", "lock payload type");
eq(lock.payload.timeout_at, now + 86400, "lock timeout_at");
const lockEnv = seal(lock.payload);
const lockBack = open(lockEnv);
ok(lockBack.type === "escrow_locked" && lockBack.job_id === "job-1", "lock envelope verifies");

// Fee accounting: escrow→lab:fees transfer spec mirrors Python's second mock_transfer
const feeSpec = { sender: escrowAcct(7), recipient: LAB_FEES_ACCT, amount_uusdc: lock.fee_uusdc };
eq(feeSpec.recipient, "lab:fees", "fee goes to lab");
eq(feeSpec.amount_uusdc, 20_000, "fee amount");

// Release on a valid signed delivery receipt
function deliveryReceipt(job_id, agent_id, delivered_ok = true) {
  return seal({ type: "delivery_receipt", job_id, agent_id, delivered_ok, created_at: now });
}
const receipt = deliveryReceipt("job-1", "worker1");
const receiptOk = open(receipt);
const rel = validateRelease(escrowRow(), receiptOk);
eq(rel.net, 1_980_000, "release net");
const releasedPayload = buildEscrowReleasedPayload({ escrow_id: 7, job_id: "job-1", agent_id: "worker1", net_uusdc: rel.net, created_at: now });
const releasedEnv = seal(releasedPayload);
const releasedBack = open(releasedEnv);
ok(releasedBack.type === "escrow_released" && releasedBack.net_uusdc === 1_980_000, "released envelope verifies");
// Double release refused
throws(() => validateRelease(escrowRow({ status: "released" }), receiptOk), Toll3Error, "double release refused");

// Release needs a matching receipt
try {
  validateRelease(escrowRow({ job_id: "job-2", agent_id: "w2" }), open(deliveryReceipt("job-OTHER", "w2")));
  assert.fail("mismatched receipt released escrow");
} catch (e) {
  ok(/job_id/.test(e.message), "wrong job_id message");
}
try {
  validateRelease(escrowRow({ job_id: "job-2", agent_id: "w2" }), open(deliveryReceipt("job-2", "w2", false)));
  assert.fail("failed-delivery receipt released escrow");
} catch (e) {
  ok(/failure/.test(e.message), "failed delivery message");
}
throws(() => validateRelease(escrowRow(), open(seal({ type: "payment_receipt", created_at: now }))), Toll3Error, "wrong envelope type refused");
try {
  validateRelease(escrowRow({ job_id: "job-2", agent_id: "w2" }), open(deliveryReceipt("job-2", "OTHER", true)));
  assert.fail("wrong agent released escrow");
} catch (e) {
  ok(/agent_id/.test(e.message), "wrong agent_id message");
}
throws(() => buildEscrowLockPayload({ escrow_id: 1, payer: "p", agent_id: "a", job_id: "", amount_uusdc: 100, job_spec_hash: "h", created_at: now }), Toll3Error, "lock needs job_id");
throws(() => buildEscrowLockPayload({ escrow_id: 1, payer: "p", agent_id: "a", job_id: "j", amount_uusdc: 100, job_spec_hash: "", created_at: now }), Toll3Error, "lock needs job_spec_hash");

// ── Timeout sweep ──────────────────────────────────────────────────────────
const timedOut = planTimeoutRefund(escrowRow({ id: 9, job_id: "job-3", payer: "p3", agent_id: "w3", amount_uusdc: 1_000_000, fee_uusdc: 10_000, timeout_at: now - 1 }), now + 10_000);
ok(timedOut !== null, "timed-out escrow swept");
eq(timedOut.newStatus, "timed_out", "swept status");
eq(timedOut.transfers.length, 1, "one refund transfer");
eq(timedOut.transfers[0].recipient, "p3", "refund goes to payer");
eq(timedOut.transfers[0].amount_uusdc, 990_000, "refund is net (fee kept)");
eq(timedOut.transfers[0].sender, "escrow:9", "refund from escrow acct");
eq(planTimeoutRefund(escrowRow({ timeout_at: now + 10_000 }), now), null, "not-yet-timed-out not swept");
eq(planTimeoutRefund(escrowRow({ status: "released", timeout_at: now - 1 }), now), null, "settled escrow not swept");

// ── Disputes: refund path ──────────────────────────────────────────────────
const dEscrow = escrowRow({ id: 11, job_id: "job-4", payer: "p4", agent_id: "w4", amount_uusdc: 1_000_000, fee_uusdc: 10_000 });
const dOpen = buildDisputeOpen({ escrowRow: dEscrow, opener: "p4", evidence: "never delivered", now });
ok(dOpen.payload.type === "dispute_opened", "dispute_opened type");
eq(dOpen.payload.fee_uusdc, DISPUTE_FEE_UUSDC, "dispute fee 5c");
eq(dOpen.feeTransfer.sender, "p4", "fee from opener");
eq(dOpen.feeTransfer.recipient, LAB_FEES_ACCT, "fee to lab");
const dAnswer = buildDisputeRespond({ disputeRow: { id: 1, status: "open" }, escrowRow: dEscrow, responder: "w4", response: "did too", now });
eq(dAnswer.type, "dispute_answered", "dispute_answered type");
eq(dAnswer.responder, "w4", "responder echoed");
const dRefund = buildDisputeResolve({ disputeRow: { id: 1, status: "answered", opener: "p4", fee_uusdc: 50_000 }, escrowRow: dEscrow, outcome: "refund", now });
eq(dRefund.resolution, "refund", "refund resolution");
eq(dRefund.openerWon, 1, "opener won");
eq(dRefund.escrowStatus, "refunded", "escrow refunded");
const dRefundBack = open(seal(dRefund.payload));
ok(dRefundBack.outcome === "refund" && dRefundBack.opener_won === 1, "refund resolution envelope verifies");
const feeBack = dRefund.transfers.find((t) => t.sender === LAB_FEES_ACCT && t.recipient === "p4");
ok(feeBack !== undefined && feeBack.amount_uusdc === DISPUTE_FEE_UUSDC, "opener got the 5c fee back");
const refundPay = dRefund.transfers.find((t) => t.recipient === "p4" && t.sender === "escrow:11");
eq(refundPay.amount_uusdc, 990_000, "payer refunded net");

// ── Disputes: release path ─────────────────────────────────────────────────
const dEscrow2 = escrowRow({ id: 12, job_id: "job-5", payer: "p5", agent_id: "w5", amount_uusdc: 1_000_000, fee_uusdc: 10_000 });
buildDisputeOpen({ escrowRow: dEscrow2, opener: "p5", evidence: "late", now });
const dRelease = buildDisputeResolve({ disputeRow: { id: 2, status: "open", opener: "p5", fee_uusdc: 50_000 }, escrowRow: dEscrow2, outcome: "release", now });
eq(dRelease.openerWon, 0, "opener lost");
eq(dRelease.escrowStatus, "released", "escrow released");
ok(!dRelease.transfers.some((t) => t.sender === LAB_FEES_ACCT), "lab kept the fee: no fee-return transfer");
const toAgent = dRelease.transfers.find((t) => t.recipient === "w5");
eq(toAgent.amount_uusdc, 990_000, "agent got net");
const dReleaseBack = open(seal(dRelease.payload));
eq(dReleaseBack.opener_won, 0, "release resolution envelope verifies");

// ── Disputes: partial path ─────────────────────────────────────────────────
const dEscrow3 = escrowRow({ id: 13, job_id: "job-6", payer: "p6", agent_id: "w6", amount_uusdc: 1_000_000, fee_uusdc: 10_000 });
buildDisputeOpen({ escrowRow: dEscrow3, opener: "p6", evidence: "half done", now });
const dPartial = buildDisputeResolve({ disputeRow: { id: 3, status: "open", opener: "p6", fee_uusdc: 50_000 }, escrowRow: dEscrow3, outcome: "partial", partial_uusdc: 400_000, now });
eq(dPartial.resolution, "partial:400000", "partial resolution label");
const dPartialBack = open(seal(dPartial.payload));
eq(dPartialBack.outcome, "partial:400000", "partial resolution envelope verifies");
const toPayer = dPartial.transfers.find((t) => t.recipient === "p6" && t.sender === "escrow:13");
eq(toPayer.amount_uusdc, 400_000, "payer got partial");
const toAgent6 = dPartial.transfers.find((t) => t.recipient === "w6");
eq(toAgent6.amount_uusdc, 590_000, "agent got remainder");
ok(dPartial.transfers.some((t) => t.sender === LAB_FEES_ACCT && t.recipient === "p6"), "fee returned on partial");

// ── Disputes: rules ────────────────────────────────────────────────────────
const dEscrow4 = escrowRow({ id: 14, job_id: "job-7", payer: "p7", agent_id: "w7" });
throws(() => buildDisputeOpen({ escrowRow: dEscrow4, opener: "stranger", now }), DisputeError, "stranger cannot open");
const d4 = buildDisputeOpen({ escrowRow: dEscrow4, opener: "p7", evidence: "x", now });
const d4Res = buildDisputeResolve({ disputeRow: { id: 4, status: "open", opener: "p7", fee_uusdc: 50_000 }, escrowRow: dEscrow4, outcome: "release", now });
eq(d4Res.escrowStatus, "released", "release settled it");
throws(() => buildDisputeOpen({ escrowRow: { ...dEscrow4, status: "released" }, opener: "p7", now }), DisputeError, "no dispute on settled escrow");
const dEscrow5 = escrowRow({ id: 15, job_id: "job-8", payer: "p8", agent_id: "w8", amount_uusdc: 1_000_000, fee_uusdc: 10_000 });
buildDisputeOpen({ escrowRow: dEscrow5, opener: "p8", evidence: "x", now });
const d5row = { id: 5, status: "open", opener: "p8", fee_uusdc: 50_000 };
throws(() => buildDisputeResolve({ disputeRow: d5row, escrowRow: dEscrow5, outcome: "partial", partial_uusdc: 990_000, now }), DisputeError, "over-net partial rejected");
throws(() => buildDisputeResolve({ disputeRow: d5row, escrowRow: dEscrow5, outcome: "partial", partial_uusdc: 0, now }), DisputeError, "zero partial rejected");
throws(() => buildDisputeResolve({ disputeRow: d5row, escrowRow: dEscrow5, outcome: "partial", partial_uusdc: 400.5, now }), DisputeError, "float partial rejected");
throws(() => buildDisputeResolve({ disputeRow: d5row, escrowRow: dEscrow5, outcome: "split", now }), DisputeError, "bad outcome rejected");
throws(() => buildDisputeResolve({ disputeRow: { ...d5row, status: "resolved" }, escrowRow: dEscrow5, outcome: "refund", now }), DisputeError, "already-resolved rejected");
throws(() => buildDisputeRespond({ disputeRow: { id: 6, status: "answered" }, escrowRow: dEscrow5, responder: "w8", response: "x", now }), DisputeError, "respond on answered rejected");
throws(() => buildDisputeRespond({ disputeRow: { id: 6, status: "open" }, escrowRow: dEscrow5, responder: "stranger", response: "x", now }), DisputeError, "stranger cannot respond");

// ── Shared pieces untouched ────────────────────────────────────────────────
const stripeSrc = readFileSync(join(__dirname, "stripe.ts"), "utf8");
ok(/reportToll3Escrow/.test(stripeSrc), "stripe.ts carries reportToll3Escrow");
const billingSrc = readFileSync(join(__dirname, "toll-billing.ts"), "utf8");
ok(/export async function resolveTollPayer/.test(billingSrc) && /export function isTollPayerOk/.test(billingSrc), "toll-billing.ts reuses resolveTollPayer/isTollPayerOk");

console.log(`toll-3.selftest: ok (${N} assertions)`);
