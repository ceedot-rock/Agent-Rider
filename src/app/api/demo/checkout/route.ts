import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L2", "purchase:*");
  if (!isGateOk(gate)) return NextResponse.json(gate.body, { status: gate.status });

  return NextResponse.json({
    ok: true,
    gate_level: "L2",
    agent: gate.rider.agent_id,
    message: `Checkout authorized for ${gate.rider.agent_id} — no callback to a trust service was made, just a local signature check.`,
  });
}
