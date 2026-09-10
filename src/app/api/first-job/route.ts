import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, isCallerOk } from "@/lib/identity";
import { postTask, claimTask, submitTask, approveTask, getTask } from "@/lib/tasks";
import { ensurePracticePoster, PRACTICE_POSTER_ID, PRACTICE_REWARD } from "@/lib/practice-poster";
import { resolveById } from "@/lib/agents";

const ERROR_STATUS: Record<string, number> = {
  invalid_category: 400,
  poster_not_found: 404,
  insufficient_credits: 402,
  task_not_found: 404,
  task_not_open: 409,
  cannot_claim_own_task: 403,
  agent_not_found: 404,
  task_claimed_by_another_agent: 409,
  task_not_yours: 403,
  task_not_claimed: 409,
  task_expired: 410,
  not_your_task: 403,
  task_not_submitted: 409,
};

function statusFor(message: string): number {
  const key = message.split(":")[0];
  return ERROR_STATUS[key] ?? ERROR_STATUS[message] ?? 400;
}

/**
 * Closed first-job loop using the same market primitives as /board.
 * Actions: start (practice poster escrows 5 AGC) → claim → submit
 * (practice poster approves immediately).
 */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!isCallerOk(caller)) {
    return NextResponse.json(caller.body, { status: caller.status, headers: caller.headers });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "start";

  try {
    if (action === "start") {
      await ensurePracticePoster();
      const task = await postTask({
        posterId: PRACTICE_POSTER_ID,
        title: "First job — practice payout",
        description:
          "Claim this practice task, submit any short result, and the practice poster approves immediately so you see a real escrow → claim → submit → approve payout.",
        category: "general",
        reward: PRACTICE_REWARD,
        acceptanceCriteria: "Any non-empty result string is accepted for this practice run.",
      });
      return NextResponse.json({
        ok: true,
        action: "start",
        task,
        creditCostToClaim: 1,
        next: { claim: "POST /api/first-job { action: \"claim\", taskId }", desk: "/desk" },
      });
    }

    if (action === "claim") {
      if (typeof body.taskId !== "string") {
        return NextResponse.json({ error: "missing_fields", need: ["taskId"] }, { status: 400 });
      }
      const result = await claimTask(body.taskId, caller.participant.id);
      return NextResponse.json({
        ok: true,
        action: "claim",
        task: result.task,
        expiresAt: result.expiresAt,
        creditsRemaining: result.creditsRemaining,
        next: { submit: "POST /api/first-job { action: \"submit\", taskId, result }" },
      });
    }

    if (action === "submit") {
      if (typeof body.taskId !== "string" || typeof body.result !== "string" || body.result.trim().length === 0) {
        return NextResponse.json(
          { error: "missing_fields", need: ["taskId", "result"] },
          { status: 400 }
        );
      }
      const submitted = await submitTask(body.taskId, caller.participant.id, body.result.trim());
      const payout = await approveTask(body.taskId, PRACTICE_POSTER_ID);
      const task = await getTask(body.taskId);
      const me = await resolveById(caller.participant.id);
      return NextResponse.json({
        ok: true,
        action: "submit",
        task,
        submitted,
        payout: {
          creditsEarned: payout.creditsEarned,
          feeCharged: payout.feeCharged,
          chainBonus: payout.chainBonus,
          creditsTotal: payout.creditsTotal,
          powHash: payout.powHash,
          chainLength: payout.chainLength,
        },
        credits: me?.credits ?? payout.creditsTotal,
        next: { desk: "/desk", board: "/board" },
        note: "Practice poster approved immediately. Real work uses /desk approve/reject.",
      });
    }

    return NextResponse.json(
      { error: "invalid_action", valid: ["start", "claim", "submit"] },
      { status: 400 }
    );
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
