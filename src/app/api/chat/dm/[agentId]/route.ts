import { NextRequest, NextResponse } from "next/server";
import { getHostApiKey, isChatUnlocked } from "@/lib/chat-gate";
import { resolveByApiKey } from "@/lib/agents";
import { listThread, markThreadRead } from "@/lib/channels";
import { resolveCanonicalId } from "@/lib/identity";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  if (!(await isChatUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const apiKey = getHostApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "no_server_key",
        hint: "HOST_CHAT_API_KEY is unset. Paste a key in the chat UI for this browser session.",
      },
      { status: 503 }
    );
  }
  const host = await resolveByApiKey(apiKey);
  if (!host) {
    return NextResponse.json({ error: "invalid_host_key" }, { status: 401 });
  }
  const selfId = await resolveCanonicalId(host.id);
  const { agentId } = await params;
  const messages = await listThread(selfId, agentId);
  await markThreadRead(selfId, agentId);
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
    self_agent_id: selfId,
    messages: mapped,
  });
}
