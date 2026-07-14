import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { checkAgentWriteLimit } from "@/lib/rate-limit";
import { answerQuery } from "@/lib/comms";

const ERROR_STATUS: Record<string, number> = {
  query_not_found: 404,
  forbidden: 403,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "queries:answer");
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

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.answer !== "string" || body.answer.trim().length === 0) {
    return NextResponse.json({ error: "missing_answer" }, { status: 400 });
  }

  try {
    const answer = await answerQuery(id, gate.rider.agent_id, body.answer);
    return NextResponse.json({ answer }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
