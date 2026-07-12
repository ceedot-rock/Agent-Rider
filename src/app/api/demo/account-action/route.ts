import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L3");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  return NextResponse.json({
    ok: true,
    gate_level: "L3",
    agent: gate.rider.agent_id,
    reputation_score: gate.rider.reputation_score,
    message: "High-stakes account action authorized — this tier also checks revocation status.",
  });
}
