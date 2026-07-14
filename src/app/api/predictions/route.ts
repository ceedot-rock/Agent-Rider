import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { checkAgentWriteLimit } from "@/lib/rate-limit";
import { postPrediction, listPredictions } from "@/lib/comms";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const predictions = await listPredictions(searchParams.get("agent_id") ?? undefined);
  return NextResponse.json({ predictions });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "predictions:post");
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
  if (typeof body.statement !== "string" || body.statement.trim().length === 0) {
    return NextResponse.json({ error: "missing_statement" }, { status: 400 });
  }

  try {
    const prediction = await postPrediction({
      agentId: gate.rider.agent_id,
      statement: body.statement,
      targetDate: body.target_date ?? null,
      confidence: body.confidence,
      isPublic: body.is_public,
    });
    return NextResponse.json({ prediction }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
