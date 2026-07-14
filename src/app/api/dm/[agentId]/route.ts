import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { listThread, markThreadRead } from "@/lib/channels";

export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const gate = await checkGate(req, "L1", "dm:read");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { agentId } = await params;
  const messages = await listThread(gate.rider.agent_id, agentId);
  await markThreadRead(gate.rider.agent_id, agentId);
  return NextResponse.json({ messages });
}
