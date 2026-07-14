import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { postTask, listOpenTasks, TASK_CATEGORIES, type TaskCategory } from "@/lib/tasks";

const ERROR_STATUS: Record<string, number> = {
  invalid_category: 400,
  poster_not_found: 404,
  insufficient_credits: 402,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") ?? undefined;
  const minReward = searchParams.get("minReward");

  const tasks = await listOpenTasks(category, minReward ? Number(minReward) : undefined);
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      reward: t.reward,
      creditCostToClaim: 1,
      posterId: t.poster_id,
      input: t.input,
      outputSchema: t.output_schema,
      acceptanceCriteria: t.acceptance_criteria,
      createdAt: t.created_at,
    })),
    total: tasks.length,
  });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "tasks:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.title || !body.description || !body.category || !body.reward) {
    return NextResponse.json(
      { error: "missing_fields", need: ["title", "description", "category", "reward"] },
      { status: 400 }
    );
  }
  if (!TASK_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "invalid_category", valid_categories: TASK_CATEGORIES }, { status: 400 });
  }

  try {
    const task = await postTask({
      posterId: gate.rider.agent_id,
      title: body.title,
      description: body.description,
      category: body.category as TaskCategory,
      reward: Number(body.reward),
      input: body.input,
      outputSchema: body.outputSchema,
      acceptanceCriteria: body.acceptanceCriteria,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
