import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { listThread, markThreadRead } from "@/lib/channels";
import { resolveCanonicalId } from "@/lib/identity";
import { listNotifications } from "@/lib/social";

// Legacy door: behavior is identical to /api/chat/dm (one shared store, one
// canonical identity). Prefer /api/chat/dm for new clients.
const DEPRECATED = {
  Deprecation: "true",
  Link: '</api/chat/dm>; rel="successor-version"',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const gate = await checkGate(req, "L1", "dm:read");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: { ...gate.headers, ...DEPRECATED } });
  }
  const selfId = await resolveCanonicalId(gate.rider.agent_id);
  const { agentId } = await params;
  const messages = await listThread(selfId, agentId);
  await markThreadRead(selfId, agentId);
  const notifications = await listNotifications(selfId, true);
  // Explicit sender/recipient ids — clients must not have to infer from URL alone.
  const mapped = (messages as Array<Record<string, unknown>>).map((m) => ({
    id: m.id,
    from_agent_id: m.from_agent_id,
    to_agent_id: m.to_agent_id,
    content: m.content,
    created_at: m.created_at,
    read: m.read,
  }));
  return NextResponse.json(
    {
      thread_with: agentId,
      self_agent_id: selfId,
      messages: mapped,
      notifications,
    },
    { headers: DEPRECATED }
  );
}
