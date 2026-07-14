import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { cancelTask } from "@/lib/tasks";

const ERROR_STATUS: Record<string, number> = {
  task_not_found: 404,
  cannot_cancel_seed_task: 403,
  not_your_task: 403,
  already_completed: 409,
  task_claimed: 409,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "tasks:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const { id } = await params;
  try {
    const { refunded } = await cancelTask(id, gate.rider.agent_id);
    return NextResponse.json({ ok: true, taskId: id, refunded });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
