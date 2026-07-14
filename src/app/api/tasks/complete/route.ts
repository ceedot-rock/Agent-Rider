import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { completeTask } from "@/lib/tasks";

const ERROR_STATUS: Record<string, number> = {
  task_not_found: 404,
  task_not_yours: 403,
  task_not_claimed: 409,
  task_expired: 410,
};

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "tasks:complete");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.taskId !== "string" || typeof body.result !== "string") {
    return NextResponse.json({ error: "missing_fields", need: ["taskId", "result"] }, { status: 400 });
  }

  try {
    const result = await completeTask(body.taskId, gate.rider.agent_id, body.result);
    return NextResponse.json({
      ok: true,
      creditsEarned: result.creditsEarned,
      chainBonus: result.chainBonus,
      creditsTotal: result.creditsTotal,
      pow: {
        hash: result.powHash,
        chainLength: result.chainLength,
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
