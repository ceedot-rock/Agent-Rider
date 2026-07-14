import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { checkAgentWriteLimit } from "@/lib/rate-limit";
import { postThought, listThoughts } from "@/lib/comms";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const thoughts = await listThoughts({
    since: searchParams.get("since") ?? undefined,
    topic: searchParams.get("topic") ?? undefined,
    agentId: searchParams.get("agent_id") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json({ thoughts });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "thoughts:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const rl = await checkAgentWriteLimit(gate.rider.agent_id);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }

  try {
    const thought = await postThought({
      agentId: gate.rider.agent_id,
      content: body.content,
      topic: body.topic,
      metadata: body.metadata,
      isPublic: body.is_public,
    });
    return NextResponse.json({ thought }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
