import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, isCallerOk } from "@/lib/identity";
import {
  postTask,
  approveTask,
  rejectTask,
  listTasksForPoster,
  TASK_CATEGORIES,
  type TaskCategory,
} from "@/lib/tasks";
import { resolveById } from "@/lib/agents";

const ERROR_STATUS: Record<string, number> = {
  invalid_category: 400,
  poster_not_found: 404,
  insufficient_credits: 402,
  task_not_found: 404,
  not_your_task: 403,
  task_not_submitted: 409,
  already_auto_approved: 410,
};

function statusFor(message: string): number {
  const key = message.split(":")[0];
  return ERROR_STATUS[key] ?? ERROR_STATUS[message] ?? 400;
}

export async function GET(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!isCallerOk(caller)) {
    return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers });
  }

  const tasks = await listTasksForPoster(caller.participant.id);
  const me = await resolveById(caller.participant.id);
  return NextResponse.json({
    agent_id: caller.participant.id,
    credits: me?.credits ?? caller.participant.credits,
    tasks,
    awaiting_review: tasks.filter((t) => t.status === "submitted"),
  });
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!isCallerOk(caller)) {
    return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "post";

  try {
    if (action === "post") {
      if (!body.title || !body.description || !body.category || body.reward == null) {
        return NextResponse.json(
          { error: "missing_fields", need: ["title", "description", "category", "reward"] },
          { status: 400 }
        );
      }
      if (!TASK_CATEGORIES.includes(body.category)) {
        return NextResponse.json(
          { error: "invalid_category", valid_categories: TASK_CATEGORIES },
          { status: 400 }
        );
      }
      const task = await postTask({
        posterId: caller.participant.id,
        title: String(body.title),
        description: String(body.description),
        category: body.category as TaskCategory,
        reward: Number(body.reward),
        input: body.input,
        outputSchema: body.outputSchema,
        acceptanceCriteria:
          typeof body.acceptanceCriteria === "string" ? body.acceptanceCriteria : undefined,
      });
      const me = await resolveById(caller.participant.id);
      return NextResponse.json(
        { ok: true, action: "post", task, credits: me?.credits ?? null },
        { status: 201 }
      );
    }

    if (action === "approve") {
      if (typeof body.taskId !== "string") {
        return NextResponse.json({ error: "missing_fields", need: ["taskId"] }, { status: 400 });
      }
      const result = await approveTask(body.taskId, caller.participant.id);
      return NextResponse.json({
        ok: true,
        action: "approve",
        taskId: body.taskId,
        creditsEarned: result.creditsEarned,
        feeCharged: result.feeCharged,
        chainBonus: result.chainBonus,
        creditsTotal: result.creditsTotal,
      });
    }

    if (action === "reject") {
      if (typeof body.taskId !== "string") {
        return NextResponse.json({ error: "missing_fields", need: ["taskId"] }, { status: 400 });
      }
      const { refunded } = await rejectTask(
        body.taskId,
        caller.participant.id,
        typeof body.reason === "string" ? body.reason : undefined
      );
      return NextResponse.json({ ok: true, action: "reject", taskId: body.taskId, refunded });
    }

    return NextResponse.json(
      { error: "invalid_action", valid: ["post", "approve", "reject"] },
      { status: 400 }
    );
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
