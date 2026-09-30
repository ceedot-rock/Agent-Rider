import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll6BondStake } from "@/lib/stripe";
import { isToll6BondsLive, TOLL6_BONDS_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  BASE_CHAIN_ID,
  BASE_USDC,
  assertBaseAddress,
  TollSettleError,
  verifyTollDeposit,
} from "@/lib/toll-settle";
import {
  validateAmountUusdc,
  validateConditions,
  newBondId,
  stakeTollFor,
  buildStakePayload,
  utcnow,
  Toll6Error,
} from "@/lib/toll-6-core.mjs";

/**
 * Toll 6 — bond stake. REAL USDC settlement on Base.
 *
 * The staker sends `amount_uusdc` of native USDC (Base chain 8453) to the lab
 * bond wallet, signs a deposit binding, and passes the deposit tx hash here.
 * Rider verifies the deposit on-chain through AwLPay BEFORE recording the
 * bond — no deposit proof, no bond. The 1% toll is metered (Stripe rail, as
 * before); the full deposit stands as slashable collateral.
 *
 * Flag TOLL6_BONDS_LIVE default OFF → 503 toll6_bonds_off (no stake, no meter).
 * Fail closed: bad body → 400, unproven deposit → 402, state-write failure
 * → 500. The toll_meter write itself is fail-open.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isToll6BondsLive()) {
    return NextResponse.json(TOLL6_BONDS_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const agent_id = body.agent_id;
  if (typeof agent_id !== "string" || agent_id.trim().length === 0) {
    return NextResponse.json({ error: "missing_agent_id" }, { status: 400, headers: CORS_HEADERS });
  }

  let amount_uusdc: number;
  try {
    amount_uusdc = validateAmountUusdc(body.amount_uusdc);
  } catch (err) {
    return NextResponse.json(
      { error: "bad_amount", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let conditions: Array<{ on: string; slash_pct: number }>;
  try {
    conditions = validateConditions(body.conditions);
  } catch (err) {
    return NextResponse.json(
      { error: "bad_conditions", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Real-settlement fields.
  const deposit_tx_hash = body.deposit_tx_hash;
  const payer_sig = body.payer_sig;
  if (typeof deposit_tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(deposit_tx_hash)) {
    return NextResponse.json(
      {
        error: "missing_deposit",
        message: "send real USDC on Base to the lab bond wallet, then call this endpoint with the deposit tx hash",
        usdc_base: BASE_USDC,
        chain_id: BASE_CHAIN_ID,
        schema_url: "/api/toll/schema",
      },
      { status: 402, headers: CORS_HEADERS }
    );
  }
  if (typeof payer_sig !== "string" || payer_sig.length === 0) {
    return NextResponse.json(
      { error: "bad_payer_sig", message: "EIP-191 personal signature binding this deposit to your ref" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  let payout_wallet: string;
  try {
    payout_wallet = assertBaseAddress(body.payout_wallet, "payout_wallet");
  } catch (err) {
    return NextResponse.json(
      { error: "bad_payout_wallet", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const sig_ref = typeof body.sig_ref === "string" && body.sig_ref.length > 0 ? body.sig_ref : agent_id;

  // Prove the real deposit BEFORE any state changes. No proof, no bond.
  let proof;
  try {
    proof = await verifyTollDeposit({
      slot: "bonds",
      tx_hash: deposit_tx_hash,
      payer_sig,
      min_uusdc: amount_uusdc,
      ref: sig_ref,
    });
  } catch (err) {
    if (err instanceof TollSettleError) {
      return NextResponse.json(
        { error: "deposit_not_proven", message: err.message },
        { status: err.status, headers: CORS_HEADERS }
      );
    }
    throw err;
  }

  // Every stake is metered (free limit 0): report to Stripe when a customer
  // is known; without one the 1% is metered in toll_meter but not billed yet.
  const usage = await checkMonthlyUsage(`toll6_stake:${payer.payer_id}`, 0);
  let metered = true;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll6BondStake(payer.stripe_customer_id);
  } else if (usage.overLimit && !payer.stripe_customer_id) {
    console.warn(
      "toll6 stake overage without stripe_customer_id",
      payer.payer_id,
      "set STRIPE_TOLL6_BOND_STAKE_METER_NAME + link customer when ready"
    );
  }

  const bond_id = newBondId();
  const toll_uusdc = stakeTollFor(amount_uusdc);
  const created_at = utcnow();

  let envelope;
  try {
    envelope = signTollPayload(
      buildStakePayload({ bond_id, agent_id, amount_uusdc, conditions, created_at })
    );
  } catch (err) {
    return NextResponse.json(
      { error: "signing_failed", message: (err as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // State writes are fail closed: any failure → 500, nothing partial is returned.
  const db = getDB();
  const { error: bondErr } = await db.from("toll_bonds").insert({
    bond_id,
    agent_id,
    amount_uusdc,
    remaining_uusdc: amount_uusdc,
    conditions_json: conditions,
    status: "active",
    stake_envelope: envelope,
    deposit_tx_hash,
    staker_wallet: proof.payer,
    payout_wallet,
    confirmed_uusdc: proof.paid_uusdc,
    chain_id: BASE_CHAIN_ID,
    token_contract: BASE_USDC,
    created_at,
  });
  if (bondErr) {
    // A deposit funds exactly one bond: a replayed tx hash is a 409,
    // never a second bond.
    if (bondErr.code === "23505") {
      return NextResponse.json(
        { error: "deposit_already_claimed", message: "this deposit tx hash already funds a bond" },
        { status: 409, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bonds", message: bondErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const { error: eventErr } = await db.from("toll_bond_events").insert({
    bond_id,
    kind: "stake",
    amount_uusdc,
    envelope_json: envelope,
    tx_hash: deposit_tx_hash,
    created_at,
  });
  if (eventErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bond_events", message: eventErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Toll meter is fail-open: a meter outage must not block the stake.
  try {
    const { error: meterErr } = await db.from("toll_meter").insert({
      module: "bonds",
      operation: "stake_1pct",
      amount_uusdc: toll_uusdc,
      ref_id: bond_id,
      created_at: Math.floor(Date.now() / 1000),
    });
    if (meterErr) throw new Error(meterErr.message);
  } catch (err) {
    console.warn("toll6 stake meter write failed (fail-open)", bond_id, (err as Error).message);
  }

  const receipt_id = `t6s_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered,
      // Toll is variable (1% of bonded value); the exact integer toll is below.
      price_usd: null,
      toll_uusdc,
      receipt_id,
      bond_id,
      deposit_tx_hash,
      staker_wallet: proof.payer,
      payout_wallet,
      confirmed_uusdc: proof.paid_uusdc,
      chain_id: BASE_CHAIN_ID,
      token_contract: BASE_USDC,
      envelope,
      usage: {
        stakesThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: usage.overLimit && Boolean(payer.stripe_customer_id),
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
