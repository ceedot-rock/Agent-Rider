import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { markNotificationRead } from "@/lib/social";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "notifications:read");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  await markNotificationRead(id, gate.rider.agent_id);
  return NextResponse.json({ ok: true, id });
}
