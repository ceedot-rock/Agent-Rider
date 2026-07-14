import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { stakeClaim, type StakePosition } from "@/lib/reputation";
import { resolveById, adjustCredits } from "@/lib/agents";

const VALID_POSITIONS = new Set<StakePosition>(["endorse", "dispute"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ claimId: string }> }) {
  const gate = await checkGate(req, "L1", "claims:stake");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const { claimId } = await params;
  const body = await req.json().catch(() => ({}));
  const position = body.position as StakePosition;
  const amount = Number(body.amount);

  if (!VALID_POSITIONS.has(position)) {
    return NextResponse.json({ error: "invalid_position", valid_positions: Array.from(VALID_POSITIONS) }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const agentId = gate.rider.agent_id;
  const participant = await resolveById(agentId);
  if (!participant) {
    return NextResponse.json({ error: "unregistered_agent", hint: "register via POST /api/agents before staking" }, { status: 403 });
  }
  if (participant.credits < amount) {
    return NextResponse.json({ error: "insufficient_credits", have: participant.credits, need: amount }, { status: 402 });
  }

  await adjustCredits(agentId, -amount, "claim_stake", { claimId, position });
  await stakeClaim(claimId, agentId, position, amount);

  return NextResponse.json({ ok: true, claimId, agentId, position, amount });
}
