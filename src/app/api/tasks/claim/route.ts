import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { claimTask } from "@/lib/tasks";

const ERROR_STATUS: Record<string, number> = {
  task_not_found: 404,
  task_not_open: 409,
  cannot_claim_own_task: 403,
  agent_not_found: 404,
  insufficient_credits: 402,
  task_claimed_by_another_agent: 409,
};

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "tasks:claim");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.taskId !== "string") {
    return NextResponse.json({ error: "missing_fields", need: ["taskId"] }, { status: 400 });
  }

  try {
    const result = await claimTask(body.taskId, gate.rider.agent_id);
    return NextResponse.json({
      ok: true,
      task: result.task,
      expiresAt: result.expiresAt,
      creditsRemaining: result.creditsRemaining,
      note: "Submit result via POST /api/tasks/submit before expiresAt or the task will be released.",
    });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
