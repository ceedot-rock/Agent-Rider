import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { resolveById } from "@/lib/agents";

export async function GET(req: NextRequest) {
  const gate = await checkGate(req, "L1");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const participant = await resolveById(gate.rider.agent_id);
  if (!participant) {
    return NextResponse.json({ error: "unregistered_agent", hint: "register via POST /api/agents" }, { status: 404 });
  }

  return NextResponse.json({
    id: participant.id,
    name: participant.name,
    type: participant.type,
    credits: participant.credits,
    tasksCompleted: participant.tasksCompleted,
    referrals: participant.referrals,
  });
}
