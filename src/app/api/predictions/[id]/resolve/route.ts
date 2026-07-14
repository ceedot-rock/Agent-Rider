import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { resolvePrediction, type PredictionOutcome } from "@/lib/comms";

const VALID_OUTCOMES = new Set<PredictionOutcome>(["correct", "incorrect", "unclear"]);

const ERROR_STATUS: Record<string, number> = {
  prediction_not_found: 404,
  forbidden: 403,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "predictions:resolve");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const outcome = body.outcome as PredictionOutcome;
  if (!VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json(
      { error: "invalid_outcome", valid_outcomes: Array.from(VALID_OUTCOMES) },
      { status: 400 }
    );
  }

  try {
    await resolvePrediction(id, gate.rider.agent_id, outcome);
    return NextResponse.json({ ok: true, id, outcome });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
