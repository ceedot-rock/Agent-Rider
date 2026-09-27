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
  TRIGGER_ATTESTATION,
  RECOURSE_POOL,
  validateSlashEvidence,
  slashAmounts,
  buildSlashPayload,
  utcnow,
  Toll6Error,
} from "@/lib/toll-6-core.mjs";

/**
 * Toll 6 — bond slash (dark).
 * Flag TOLL6_BONDS_LIVE default OFF → 503 toll6_bonds_off.
 * Body: {bond_id, trigger, evidence_envelope}.
 * The evidence envelope must be a lab-signed attestation whose type/verdict
 * matches the trigger (see TRIGGER_ATTESTATION in toll-6-core.mjs) and which
 * references this bond. Slashes are not metered — only the stake (1%) and
 * the audit export (5¢) are. Settlement mocked in toll_mock_balances.
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

  // Recipient: evidence pay_to when present, else the lab recourse pool.
  const payTo = evidencePayload.pay_to;
  const recipient = typeof payTo === "string" && payTo.length > 0 ? payTo : RECOURSE_POOL;

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

  // State writes fail closed.
  const { error: updErr } = await db
    .from("toll_bonds")
    .update({ remaining_uusdc: newRemaining, status: newStatus })
    .eq("bond_id", bond_id);
  if (updErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bonds", message: updErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Mock settlement: escrow → recipient. No real money.
  const escrow = "bond:" + bond_id;
  const { data: escRow, error: escSelErr } = await db
    .from("toll_mock_balances")
    .select("balance_uusdc")
    .eq("agent_id", escrow)
    .maybeSingle();
  if (escSelErr || !escRow || Number(escRow.balance_uusdc) < slashAmt) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_mock_balances", message: escSelErr?.message ?? "escrow short" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  const { error: escDebitErr } = await db
    .from("toll_mock_balances")
    .update({ balance_uusdc: Number(escRow.balance_uusdc) - slashAmt })
    .eq("agent_id", escrow);
  if (escDebitErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_mock_balances", message: escDebitErr.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  const { data: recRow } = await db
    .from("toll_mock_balances")
    .select("balance_uusdc")
    .eq("agent_id", recipient)
    .maybeSingle();
  if (recRow) {
    const { error: recErr } = await db
      .from("toll_mock_balances")
      .update({ balance_uusdc: Number(recRow.balance_uusdc) + slashAmt })
      .eq("agent_id", recipient);
    if (recErr) {
      return NextResponse.json(
        { error: "state_write_failed", table: "toll_mock_balances", message: recErr.message },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  } else {
    const { error: recErr } = await db
      .from("toll_mock_balances")
      .insert({ agent_id: recipient, balance_uusdc: slashAmt });
    if (recErr) {
      return NextResponse.json(
        { error: "state_write_failed", table: "toll_mock_balances", message: recErr.message },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  const { error: eventErr } = await db.from("toll_bond_events").insert({
    bond_id,
    kind: "slash",
    amount_uusdc: slashAmt,
    envelope_json: envelope,
    created_at,
  });
  if (eventErr) {
    return NextResponse.json(
      { error: "state_write_failed", table: "toll_bond_events", message: eventErr.message },
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
      remaining_uusdc: newRemaining,
      status: newStatus,
      receipt_id,
      usage: { slashesThisMonth: usage.count, overage: usage.overLimit },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
