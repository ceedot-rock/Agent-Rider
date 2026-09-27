import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll6BondStake } from "@/lib/stripe";
import { isToll6BondsLive, TOLL6_BONDS_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
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
 * Toll 6 — bond stake (dark).
 * Flag TOLL6_BONDS_LIVE default OFF → 503 toll6_bonds_off (no stake, no meter).
 * Body: {agent_id, amount_uusdc (integer micro-USDC > 0), conditions[]}.
 * Toll: 1% of bonded value, metered only (no real charge). Settlement mocked
 * in toll_mock_balances — no real USDC ever moves.
 * Fail closed: bad body → 400, insufficient mocked balance → 402,
 * state-write failure → 500. The toll_meter write itself is fail-open.
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

  const db = getDB();

  // Mocked balance check: agent must actually hold the stake amount.
  const { data: balRow, error: balErr } = await db
    .from("toll_mock_balances")
    .select("balance_uusdc")
    .eq("agent_id", agent_id)
    .maybeSingle();
  if (balErr) {
    return NextResponse.json(
      { error: "balance_check_failed", message: balErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  const balance = Number(balRow?.balance_uusdc ?? 0);
  if (balance < amount_uusdc) {
    return NextResponse.json(
      { error: "insufficient_balance", agent_id, balance_uusdc: balance, needed_uusdc: amount_uusdc },
      { status: 402, headers: CORS_HEADERS }
    );
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
  const { error: bondErr } = await db.from("toll_bonds").insert({
    bond_id,
    agent_id,
    amount_uusdc,
    remaining_uusdc: amount_uusdc,
    conditions_json: conditions,
    status: "active",
    stake_envelope: envelope,
    created_at,
  });
  if (bondErr) {
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
    created_at,
  });
  if (eventErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bond_events", message: eventErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Mock settlement: lock the stake in a per-bond escrow row. No real money.
  const escrow = "bond:" + bond_id;
  const { error: debitErr } = await db
    .from("toll_mock_balances")
    .update({ balance_uusdc: balance - amount_uusdc })
    .eq("agent_id", agent_id);
  if (debitErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_mock_balances", message: debitErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  const { data: escRow } = await db
    .from("toll_mock_balances")
    .select("balance_uusdc")
    .eq("agent_id", escrow)
    .maybeSingle();
  if (escRow) {
    const { error: escErr } = await db
      .from("toll_mock_balances")
      .update({ balance_uusdc: Number(escRow.balance_uusdc) + amount_uusdc })
      .eq("agent_id", escrow);
    if (escErr) {
      return NextResponse.json(
        { error: "state_write_failed", table: "toll_mock_balances", message: escErr.message },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  } else {
    const { error: escErr } = await db
      .from("toll_mock_balances")
      .insert({ agent_id: escrow, balance_uusdc: amount_uusdc });
    if (escErr) {
      return NextResponse.json(
        { error: "state_write_failed", table: "toll_mock_balances", message: escErr.message },
        { status: 500, headers: CORS_HEADERS }
      );
    }
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
