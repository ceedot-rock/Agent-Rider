import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { checkAgentWriteLimit } from "@/lib/rate-limit";
import { postQuery, listQueries } from "@/lib/comms";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queries = await listQueries({
    status: searchParams.get("status") ?? undefined,
    targetAgentId: searchParams.get("target_agent_id") ?? undefined,
  });
  return NextResponse.json({ queries });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "queries:post");
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
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return NextResponse.json({ error: "missing_question" }, { status: 400 });
  }

  try {
    const query = await postQuery({
      fromAgentId: gate.rider.agent_id,
      question: body.question,
      targetAgentId: body.target_agent_id ?? null,
      isPublic: body.is_public,
    });
    return NextResponse.json({ query }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
