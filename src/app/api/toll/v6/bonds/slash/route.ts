import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { isToll6BondsLive, TOLL6_BONDS_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import {
  signTollPayload,
  verifyTollEnvelope,
  tollEnvelopeId,
  labJwks,
} from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  BASE_CHAIN_ID,
  BASE_USDC,
  assertBaseAddress,
  TollSettleError,
  tollSend,
} from "@/lib/toll-settle";
import {
  TRIGGER_ATTESTATION,
  validateSlashEvidence,
  slashAmounts,
  buildSlashPayload,
  utcnow,
  Toll6Error,
} from "@/lib/toll-6-core.mjs";

/**
 * Toll 6 — bond slash. REAL USDC settlement on Base.
 *
 * Body: {bond_id, trigger, evidence_envelope}.
 * The evidence envelope must be a lab-signed attestation whose type/verdict
 * matches the trigger (see TRIGGER_ATTESTATION in toll-6-core.mjs) and which
 * references this bond. On success the bond wallet sends the slashed amount
 * in real Base USDC to the evidence pay_to address (or the lab recourse
 * wallet) via AwLPay — idempotent, so retries and crash recovery can never
 * double-slash.
 *
 * Safety rules:
 * - Bonds staked before real settlement (no deposit_tx_hash) can NEVER move
 *   real money → 409 bond_predates_real_settlement.
 * - The slash recipient must be a real Base address: evidence pay_to, else
 *   TOLL_RECOURSE_WALLET (fail closed when neither is payable).
 *
 * Flag TOLL6_BONDS_LIVE default OFF → 503 toll6_bonds_off.
 * Slashes are not metered — only the stake (1%) and the audit export (5¢) are.
 * Fail closed throughout: bad evidence or a non-active bond is refused.
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
  const bond_id = body.bond_id;
  const trigger = body.trigger;
  const evidence_envelope = body.evidence_envelope;
  if (typeof bond_id !== "string" || bond_id.length === 0) {
    return NextResponse.json({ error: "missing_bond_id" }, { status: 400, headers: CORS_HEADERS });
  }
  if (typeof trigger !== "string" || trigger.length === 0) {
    return NextResponse.json({ error: "missing_trigger" }, { status: 400, headers: CORS_HEADERS });
  }
  if (typeof evidence_envelope !== "object" || evidence_envelope === null) {
    return NextResponse.json({ error: "missing_evidence_envelope" }, { status: 400, headers: CORS_HEADERS });
  }

  // Evidence verification is fail closed: unverifiable evidence is refused,
  // never treated as a pass.
  let evidencePayload: Record<string, unknown>;
  try {
    evidencePayload = verifyTollEnvelope(evidence_envelope, labJwks()) as Record<string, unknown>;
  } catch (err) {
    return NextResponse.json(
      { error: "bad_evidence", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!(trigger in TRIGGER_ATTESTATION)) {
    return NextResponse.json(
      { error: "unknown_trigger", known: Object.keys(TRIGGER_ATTESTATION).sort() },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const db = getDB();
  const { data: bond, error: bondErr } = await db
    .from("toll_bonds")
    .select("*")
    .eq("bond_id", bond_id)
    .maybeSingle();
  if (bondErr) {
    return NextResponse.json(
      { error: "bond_lookup_failed", message: bondErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  if (!bond) {
    return NextResponse.json({ error: "unknown_bond", bond_id }, { status: 404, headers: CORS_HEADERS });
  }
  if (bond.status !== "active") {
    return NextResponse.json(
      { error: "bond_not_active", bond_id, status: bond.status },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Mock-era bonds never received real deposits — real money must never
  // move against them.
  if (!bond.deposit_tx_hash) {
    return NextResponse.json(
      { error: "bond_predates_real_settlement", reason: "this bond was staked before real USDC settlement; it cannot move real funds" },
      { status: 409, headers: CORS_HEADERS }
    );
  }

  const conditions = Array.isArray(bond.conditions_json) ? bond.conditions_json : [];
  const cond = conditions.find((c: { on?: string }) => c?.on === trigger);
  if (!cond) {
    return NextResponse.json(
      { error: "trigger_not_in_conditions", bond_id, trigger },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    validateSlashEvidence(evidencePayload, bond_id, trigger);
  } catch (err) {
    return NextResponse.json(
      { error: "evidence_mismatch", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const remaining_uusdc = Number(bond.remaining_uusdc);
  const slash_pct = Number(cond.slash_pct);
  let slashAmt: number;
  let newRemaining: number;
  let newStatus: string;
  try {
    ({ slashAmt, remaining: newRemaining, newStatus } = slashAmounts(remaining_uusdc, slash_pct));
  } catch (err) {
    return NextResponse.json(
      { error: "nothing_to_slash", message: (err as Error).message },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Recipient must be a real Base address: evidence pay_to when payable,
  // else the lab recourse wallet. Fail closed — slashed funds must land
  // somewhere real, never nowhere.
  let recipient: string;
  const payTo = evidencePayload.pay_to;
  if (typeof payTo === "string" && /^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    recipient = payTo;
  } else {
    try {
      recipient = assertBaseAddress(process.env.TOLL_RECOURSE_WALLET, "TOLL_RECOURSE_WALLET");
    } catch {
      return NextResponse.json(
        { error: "slash_recipient_unpayable", reason: "evidence pay_to is not a Base address and TOLL_RECOURSE_WALLET is unconfigured" },
        { status: 409, headers: CORS_HEADERS }
      );
    }
  }

  const created_at = utcnow();
  let envelope;
  try {
    envelope = signTollPayload(
      buildSlashPayload({
        bond_id,
        agent_id: bond.agent_id,
        trigger,
        slash_pct,
        slashed_uusdc: slashAmt,
        recipient,
        evidence_id: tollEnvelopeId(evidence_envelope),
        remaining_uusdc: newRemaining,
        created_at,
      })
    );
  } catch (err) {
    return NextResponse.json(
      { error: "signing_failed", message: (err as Error).message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Real money movement. The idempotency key is deterministic per
  // (bond, remaining-before, remaining-after): a crash or client retry
  // replays into the SAME on-chain transfer, never a second one.
  const idemKey = `t6:slash:${bond_id}:${remaining_uusdc}-${newRemaining}`;
  let slashTx: string;
  try {
    ({ tx_hash: slashTx } = await tollSend({
      slot: "bonds",
      to_address: recipient,
      amount_uusdc: slashAmt,
      idempotency_key: idemKey,
      purpose: "bond_slash",
    }));
  } catch (err) {
    const status = err instanceof TollSettleError ? err.status : 502;
    console.error("toll6 slash: toll send failed", (err as Error).message);
    return NextResponse.json(
      { error: "slash_send_failed", message: (err as Error).message },
      { status, headers: CORS_HEADERS }
    );
  }

  // State write, conditional on the balance we just slashed from: if another
  // attempt already applied this slash (crash between send and write), the
  // row no longer matches and we replay the original result instead of
  // double-applying.
  const upd = await db
    .from("toll_bonds")
    .update({ remaining_uusdc: newRemaining, status: newStatus, slash_tx_hash: slashTx })
    .eq("bond_id", bond_id)
    .eq("remaining_uusdc", remaining_uusdc);
  if (upd.error) {
    console.error("toll6 slash: bond update failed", upd.error.message);
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bonds", message: upd.error.message, slash_tx: slashTx },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Append-only chain transfer log — fail open; the chain tx is the truth.
  try {
    await db.from("toll_chain_transfers").insert({
      kind: "slash",
      ref_id: bond_id,
      tx_hash: slashTx,
      from_slot: "bonds",
      to_wallet: recipient,
      amount_uusdc: slashAmt,
      idempotency_key: idemKey,
      created_at: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    console.error("toll6 slash: chain-transfer log failed (fail-open)", (err as Error).message);
  }

  const { error: eventErr } = await db.from("toll_bond_events").insert({
    bond_id,
    kind: "slash",
    amount_uusdc: slashAmt,
    envelope_json: envelope,
    tx_hash: slashTx,
    created_at,
  });
  if (eventErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bond_events", message: eventErr.message, slash_tx: slashTx },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const usage = await checkMonthlyUsage(`toll6_slash:${payer.payer_id}`, 0);
  const receipt_id = `t6x_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      // Slashes are not metered (only stake 1% + audit export 5¢ are).
      metered: false,
      envelope,
      slashed_uusdc: slashAmt,
      recipient,
      slash_tx: slashTx,
      remaining_uusdc: newRemaining,
      status: newStatus,
      chain_id: BASE_CHAIN_ID,
      token_contract: BASE_USDC,
      receipt_id,
      usage: { slashesThisMonth: usage.count, overage: usage.overLimit },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
