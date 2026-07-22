import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { approveTask } from "@/lib/tasks";

const ERROR_STATUS: Record<string, number> = {
  task_not_found: 404,
  not_your_task: 403,
  task_not_submitted: 409,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "tasks:approve");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const { id } = await params;
  try {
    const result = await approveTask(id, gate.rider.agent_id);
    return NextResponse.json({
      ok: true,
      taskId: id,
      creditsEarned: result.creditsEarned,
      feeCharged: result.feeCharged,
      chainBonus: result.chainBonus,
      creditsTotal: result.creditsTotal,
      pow: { hash: result.powHash, chainLength: result.chainLength },
    });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
