/**
 * Toll 3 — escrow / billing pure logic. No DB, no network.
 * Port of ~/workspace/rider-toll/tollkeeper/billing.py (82/82 green).
 * Selftest-importable; routes wrap these builders with DB + lab-key signing.
 *
 * Money: integer micro-USDC (uusdc). 1 USDC = 1_000_000 uusdc.
 * NO float arithmetic on money anywhere in this file.
 */

import { createHash } from "node:crypto";

export const MICRO = 1_000_000;
export const DISPUTE_FEE_UUSDC = 50_000; // 5¢ in uusdc
export const ESCROW_FEE_BPS = 100; // 1% routing fee at lock time
export const LAB_FEES_ACCT = "lab:fees";

export const WINDOWS = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
  job: null,
};

export class Toll3Error extends Error {}

/** 402-style refusal: the budget cannot cover this charge. */
export class BudgetExhaustedError extends Toll3Error {
  constructor(agent_id, cap, spent, amount) {
    super(
      `BUDGET_EXHAUSTED: agent ${agent_id} cap ${cap} spent ${spent} charge ${amount} (uusdc)`
    );
    this.http_status = 402;
    this.code = "BUDGET_EXHAUSTED";
    this.agent_id = agent_id;
    this.cap = cap;
    this.spent = spent;
    this.amount = amount;
  }
  as402() {
    return {
      status: this.http_status,
      code: this.code,
      agent_id: this.agent_id,
      cap_uusdc: this.cap,
      spent_uusdc: this.spent,
      charge_uusdc: this.amount,
    };
  }
}

/** Dispute-flow failure. */
export class DisputeError extends Toll3Error {}

// ── Amounts ────────────────────────────────────────────────────────────────

/** Reject bool/float/string/<=0 — amounts must be positive integers. */
export function validateAmountUusdc(v) {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new Toll3Error("amount must be a positive int (uusdc)");
  }
  return v;
}

/** 1% routing fee at lock time. Integer math only. */
export function escrowFeeFor(amount_uusdc) {
  validateAmountUusdc(amount_uusdc);
  const fee = Math.floor((amount_uusdc * ESCROW_FEE_BPS) / 10000);
  return { fee, net: amount_uusdc - fee };
}

// ── Mocked settlement ledger ──────────────────────────────────────────────

function preimage(sender, recipient, amount_uusdc, memo, now, nonce) {
  return `${sender}|${recipient}|${amount_uusdc}|${memo}|${now}|${nonce}`;
}

/**
 * Fake USDC transfer hash — prefixed "mock_" so it can never be mistaken
 * for a real transaction. Mirrors the Python preimage format exactly.
 */
export function mockTxHash(sender, recipient, amount_uusdc, memo, now, nonce) {
  validateAmountUusdc(amount_uusdc);
  const hex = createHash("sha256")
    .update(preimage(sender, recipient, amount_uusdc, memo, now, nonce), "utf8")
    .digest("hex");
  return "mock_" + hex;
}

/**
 * Per-process nonce source so no two mock txs collide, even with identical
 * sender/recipient/amount/memo/now (mirrors Python's _TX_COUNTER).
 */
export function makeMockTxHasher() {
  let counter = 0;
  return (sender, recipient, amount_uusdc, memo, now, extraNonce) => {
    counter += 1;
    const nonce = extraNonce === undefined ? counter : `${counter}:${extraNonce}`;
    return mockTxHash(sender, recipient, amount_uusdc, memo, now, nonce);
  };
}

/** Signed verified-payment receipt payload for a ledger transfer. */
export function buildPaymentReceiptPayload(tx, now) {
  if (!tx || typeof tx.tx_hash !== "string" || tx.tx_hash.length === 0) {
    throw new Toll3Error("unknown tx_hash");
  }
  return {
    type: "payment_receipt",
    tx_hash: tx.tx_hash,
    sender: tx.sender,
    recipient: tx.recipient,
    amount_uusdc: tx.amount_uusdc,
    created_at: now,
  };
}

/** Mainnet hook — STUB. Real settlement is never attempted from here. */
export function settleOnchain() {
  throw new Error(
    "settleOnchain is a stub: no real USDC moves without explicit per-charge approval, executed through the x402 flow."
  );
}

// ── Escrow ─────────────────────────────────────────────────────────────────

export function escrowAcct(escrow_id) {
  return `escrow:${escrow_id}`;
}

/** Pure lock computation: fee/net/timeout + signed payload dict (not the envelope). */
export function buildEscrowLockPayload({
  escrow_id,
  payer,
  agent_id,
  job_id,
  amount_uusdc,
  job_spec_hash,
  timeout_sec = 86400,
  created_at,
}) {
  validateAmountUusdc(amount_uusdc);
  if (!job_id || !job_spec_hash) {
    throw new Toll3Error("job_id and job_spec_hash are required");
  }
  if (!Number.isInteger(timeout_sec) || timeout_sec <= 0) {
    throw new Toll3Error("timeout_sec must be a positive int");
  }
  const { fee, net } = escrowFeeFor(amount_uusdc);
  return {
    payload: {
      type: "escrow_locked",
      escrow_id,
      job_id,
      payer,
      agent_id,
      amount_uusdc,
      fee_uusdc: fee,
      job_spec_hash,
      timeout_at: created_at + timeout_sec,
      created_at,
    },
    fee_uusdc: fee,
    net_uusdc: net,
  };
}

/**
 * Validate a verified delivery-receipt payload against an escrow row.
 * escrowRow: {id, job_id, agent_id, amount_uusdc, fee_uusdc, status}.
 * Throws unless receipt type==="delivery_receipt", delivered_ok===true,
 * job_id+agent_id match the row, and the row is locked. Returns {net}.
 */
export function validateRelease(escrowRow, receiptPayload) {
  if (!escrowRow) throw new Toll3Error("unknown escrow");
  if (receiptPayload?.type !== "delivery_receipt") {
    throw new Toll3Error("envelope is not a delivery receipt");
  }
  if (!receiptPayload.delivered_ok) {
    throw new Toll3Error("delivery receipt reports failure; use disputes");
  }
  if (escrowRow.status !== "locked") {
    throw new Toll3Error(
      `escrow ${escrowRow.id} is ${escrowRow.status}, not locked`
    );
  }
  if (receiptPayload.job_id !== escrowRow.job_id) {
    throw new Toll3Error("receipt job_id does not match escrow");
  }
  if (receiptPayload.agent_id !== escrowRow.agent_id) {
    throw new Toll3Error("receipt agent_id does not match escrow");
  }
  return { net: escrowRow.amount_uusdc - escrowRow.fee_uusdc };
}

export function buildEscrowReleasedPayload({
  escrow_id,
  job_id,
  agent_id,
  net_uusdc,
  created_at,
}) {
  return {
    type: "escrow_released",
    escrow_id,
    job_id,
    agent_id,
    net_uusdc,
    created_at,
  };
}

/**
 * Timeout sweep plan for one escrow row: refund the payer the net (lab
 * keeps the lock-time fee). Returns null when the row is not sweepable.
 */
export function planTimeoutRefund(escrowRow, now) {
  if (escrowRow.status !== "locked") return null;
  if (!(now >= escrowRow.timeout_at)) return null;
  const net = escrowRow.amount_uusdc - escrowRow.fee_uusdc;
  return {
    escrow_id: escrowRow.id,
    newStatus: "timed_out",
    transfers: [
      {
        sender: escrowAcct(escrowRow.id),
        recipient: escrowRow.payer,
        amount_uusdc: net,
        memo: `escrow timeout refund job ${escrowRow.job_id}`,
      },
    ],
  };
}

// ── Disputes ───────────────────────────────────────────────────────────────

/** Open a dispute on a locked escrow. Opener must be the payer or the agent. */
export function buildDisputeOpen({ escrowRow, opener, evidence = "", now }) {
  if (!escrowRow) throw new DisputeError("unknown escrow");
  if (escrowRow.status !== "locked") {
    throw new DisputeError(
      `escrow ${escrowRow.id} is ${escrowRow.status}; disputes need locked funds`
    );
  }
  if (opener !== escrowRow.payer && opener !== escrowRow.agent_id) {
    throw new DisputeError("opener must be the payer or the agent");
  }
  return {
    payload: {
      type: "dispute_opened",
      escrow_id: escrowRow.id,
      opener,
      evidence,
      fee_uusdc: DISPUTE_FEE_UUSDC,
      created_at: now,
    },
    feeTransfer: {
      sender: opener,
      recipient: LAB_FEES_ACCT,
      amount_uusdc: DISPUTE_FEE_UUSDC,
      memo: `dispute fee escrow ${escrowRow.id}`,
    },
  };
}

/** Counterparty response to an open dispute. */
export function buildDisputeRespond({ disputeRow, escrowRow, responder, response, now }) {
  if (!disputeRow) throw new DisputeError("unknown dispute");
  if (disputeRow.status !== "open") {
    throw new DisputeError(`dispute ${disputeRow.id} is ${disputeRow.status}`);
  }
  if (responder !== escrowRow.payer && responder !== escrowRow.agent_id) {
    throw new DisputeError("responder must be a party to the escrow");
  }
  return {
    type: "dispute_answered",
    dispute_id: disputeRow.id,
    responder,
    response,
    created_at: now,
  };
}

/**
 * Resolution plan. outcome ∈ {"refund","partial","release"}.
 * - refund: payer gets net escrow; opener's 5¢ fee returned (opener wins).
 * - release: agent gets net escrow; lab keeps the 5¢ (opener loses).
 * - partial: partial_uusdc to payer, remainder to agent; fee returned.
 * Returns {transfers, escrowStatus, openerWon, resolution, payload}.
 */
export function buildDisputeResolve({
  disputeRow,
  escrowRow,
  outcome,
  partial_uusdc,
  resolver = "lab",
  now,
}) {
  if (outcome !== "refund" && outcome !== "partial" && outcome !== "release") {
    throw new DisputeError("outcome must be refund|partial|release");
  }
  if (!disputeRow) throw new DisputeError("unknown dispute");
  if (disputeRow.status !== "open" && disputeRow.status !== "answered") {
    throw new DisputeError(`dispute ${disputeRow.id} already ${disputeRow.status}`);
  }
  if (!escrowRow) throw new DisputeError("unknown escrow");
  if (escrowRow.status !== "locked") {
    throw new DisputeError(`escrow ${escrowRow.id} is ${escrowRow.status}`);
  }
  const net = escrowRow.amount_uusdc - escrowRow.fee_uusdc;
  const acct = escrowAcct(escrowRow.id);
  const feeBack = {
    sender: LAB_FEES_ACCT,
    recipient: disputeRow.opener,
    amount_uusdc: disputeRow.fee_uusdc ?? DISPUTE_FEE_UUSDC,
    memo: `dispute fee returned ${disputeRow.id}`,
  };
  let transfers, escrowStatus, openerWon, resolution;
  if (outcome === "refund") {
    transfers = [
      {
        sender: acct,
        recipient: escrowRow.payer,
        amount_uusdc: net,
        memo: `dispute refund job ${escrowRow.job_id}`,
      },
      feeBack,
    ];
    openerWon = 1;
    resolution = "refund";
    escrowStatus = "refunded";
  } else if (outcome === "release") {
    transfers = [
      {
        sender: acct,
        recipient: escrowRow.agent_id,
        amount_uusdc: net,
        memo: `dispute release job ${escrowRow.job_id}`,
      },
    ];
    openerWon = 0;
    resolution = "release";
    escrowStatus = "released";
  } else {
    if (!Number.isInteger(partial_uusdc) || !(partial_uusdc > 0) || !(partial_uusdc < net)) {
      throw new DisputeError(`partial needs 0 < partial_uusdc < net (${net})`);
    }
    transfers = [
      {
        sender: acct,
        recipient: escrowRow.payer,
        amount_uusdc: partial_uusdc,
        memo: `dispute partial job ${escrowRow.job_id}`,
      },
      {
        sender: acct,
        recipient: escrowRow.agent_id,
        amount_uusdc: net - partial_uusdc,
        memo: `dispute partial job ${escrowRow.job_id}`,
      },
      feeBack,
    ];
    openerWon = 1;
    resolution = `partial:${partial_uusdc}`;
    escrowStatus = "released";
  }
  return {
    transfers,
    escrowStatus,
    openerWon,
    resolution,
    payload: {
      type: "dispute_resolved",
      dispute_id: disputeRow.id,
      escrow_id: escrowRow.id,
      outcome: resolution,
      opener_won: openerWon,
      resolver,
      created_at: now,
    },
  };
}

// ── Budgets ────────────────────────────────────────────────────────────────

/** Validate budget shape. Returns normalized {agent_id, cap_uusdc, window, window_secs, categories}. */
export function validateBudget({ agent_id, cap_uusdc, window = "monthly", categories = [] }) {
  if (!(window in WINDOWS)) {
    throw new Toll3Error(`unknown window ${JSON.stringify(window)}`);
  }
  if (typeof cap_uusdc !== "number" || !Number.isInteger(cap_uusdc) || cap_uusdc <= 0) {
    throw new Toll3Error("cap must be a positive int (uusdc)");
  }
  return {
    agent_id,
    cap_uusdc,
    window,
    window_secs: WINDOWS[window],
    categories: Array.isArray(categories) ? categories.slice() : [],
  };
}

/**
 * Pick the active budget for an agent+category, rolling the window when it
 * expired. rows: [{id, cap_uusdc, spent_uusdc, window, window_start,
 * categories:[...], created_at}], newest first. Returns {budget, rolled} or
 * null when no budget matches.
 */
export function selectActiveBudget(rows, category, now) {
  const sorted = [...rows].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  for (const row of sorted) {
    const cats = row.categories ?? [];
    if (cats.length > 0 && !cats.includes(category)) continue;
    const secs = WINDOWS[row.window];
    if (secs !== null && secs !== undefined && now >= row.window_start + secs) {
      return { budget: { ...row, spent_uusdc: 0, window_start: now }, rolled: true };
    }
    return { budget: { ...row }, rolled: false };
  }
  return null;
}

/**
 * Decrement the budget. Returns {budget_id, spent, cap} or throws
 * BudgetExhaustedError (code BUDGET_EXHAUSTED, HTTP 402).
 */
export function authorizeBudget(budget, amount_uusdc, agent_id) {
  validateAmountUusdc(amount_uusdc);
  if (!budget) {
    throw new BudgetExhaustedError(agent_id, 0, 0, amount_uusdc);
  }
  if (budget.spent_uusdc + amount_uusdc > budget.cap_uusdc) {
    throw new BudgetExhaustedError(
      agent_id,
      budget.cap_uusdc,
      budget.spent_uusdc,
      amount_uusdc
    );
  }
  return {
    budget_id: budget.id,
    spent: budget.spent_uusdc + amount_uusdc,
    cap: budget.cap_uusdc,
  };
}
