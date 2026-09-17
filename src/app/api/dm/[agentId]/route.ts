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
  // Explicit sender/recipient ids — clients must not have to infer from URL alone.
  const mapped = (messages as Array<Record<string, unknown>>).map((m) => ({
    id: m.id,
    from_agent_id: m.from_agent_id,
    to_agent_id: m.to_agent_id,
    content: m.content,
    created_at: m.created_at,
    read: m.read,
  }));
  return NextResponse.json({
    thread_with: agentId,
    self_agent_id: gate.rider.agent_id,
    messages: mapped,
  });
}
