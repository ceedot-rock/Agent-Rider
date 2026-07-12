import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";

export async function GET(req: NextRequest) {
  const gate = await checkGate(req, "L1", "read:catalog");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  return NextResponse.json({
    ok: true,
    gate_level: "L1",
    agent: gate.rider.agent_id,
    catalog: [
      { id: "item_1", name: "Trail runner shoes", price: 129 },
      { id: "item_2", name: "Insulated water bottle", price: 24 },
    ],
  });
}
