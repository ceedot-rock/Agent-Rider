import { randomBytes } from "crypto";
import { getDB } from "@/lib/db";
import { resolveById, adjustCredits } from "@/lib/agents";
import { generatePoW, verifyPoWChain, powChainCreditBonus } from "@/lib/reputation";
import { mirrorCreditToOperator } from "@/lib/credits";

// Task board with credit escrow — ported from agentmagnet/routes/agent.js.
// AgentNet's richer task/marketplace model (task #6) builds on top of this
// table rather than replacing it.

export const TASK_CATEGORIES = ["nlp", "classification", "dev", "general"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

const CLAIM_COST = 1;
const CLAIM_WINDOW_MS = 30 * 60 * 1000;
const MIN_REWARD = 5;
const MAX_REWARD = 500;

// Platform cut of each task payout, same shape as Upwork/Fiverr taking a %
// off a freelancer's earnings rather than surcharging the poster — the
// poster still escrows exactly task.reward at postTask() time. Applies only
// to the reward the poster funded, not the PoW chain bonus (that's a
// platform-funded emission, not money changing hands between two parties).
const TASK_FEE_RATE = Number(process.env.TASK_FEE_RATE ?? 0.05);
const PLATFORM_TREASURY_ID = "platform-treasury";

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  reward: number;
  poster_id: string | null;
  input: unknown;
  output_schema: unknown;
  acceptance_criteria: string | null;
  status: "open" | "claimed" | "completed" | "expired";
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  result: string | null;
  created_at: string;
}

async function releaseIfExpired(task: TaskRow): Promise<TaskRow> {
  if (task.status !== "claimed" || !task.expires_at) return task;
  if (new Date(task.expires_at).getTime() >= Date.now()) return task;

  const db = getDB();
  await db
    .from("tasks")
    .update({ status: "open", claimed_by: null, claimed_at: null, expires_at: null })
    .eq("id", task.id);

  return { ...task, status: "open", claimed_by: null, claimed_at: null, expires_at: null };
}

export interface PostTaskInput {
  posterId: string;
  title: string;
  description: string;
  category: TaskCategory;
  reward: number;
  input?: unknown;
  outputSchema?: unknown;
  acceptanceCriteria?: string;
}

export async function postTask(input: PostTaskInput): Promise<TaskRow> {
  if (!TASK_CATEGORIES.includes(input.category)) throw new Error("invalid_category");
  if (!Number.isFinite(input.reward) || input.reward < MIN_REWARD || input.reward > MAX_REWARD) {
    throw new Error(`invalid_reward: must be between ${MIN_REWARD} and ${MAX_REWARD}`);
  }

  const poster = await resolveById(input.posterId);
  if (!poster) throw new Error("poster_not_found");
  if (poster.credits < input.reward) throw new Error("insufficient_credits");

  // Escrow the reward from the poster's balance up front.
  await adjustCredits(input.posterId, -input.reward, "task_escrow", { taskTitle: input.title });

  const db = getDB();
  const { data, error } = await db
    .from("tasks")
    .insert({
      id: "tsk_" + randomBytes(8).toString("hex"),
      title: input.title.slice(0, 200),
      description: input.description.slice(0, 2000),
      category: input.category,
      reward: input.reward,
      poster_id: input.posterId,
      input: input.input ?? null,
      output_schema: input.outputSchema ?? null,
      acceptance_criteria: input.acceptanceCriteria?.slice(0, 1000) ?? null,
      status: "open",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`postTask: ${error?.message ?? "insert failed"}`);
  return data as TaskRow;
}

export async function cancelTask(taskId: string, requesterId: string): Promise<{ refunded: number }> {
  const db = getDB();
  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) throw new Error("task_not_found");
  if (!task.poster_id) throw new Error("cannot_cancel_seed_task");
  if (task.poster_id !== requesterId) throw new Error("not_your_task");
  if (task.status === "completed") throw new Error("already_completed");
  if (task.status === "claimed") throw new Error("task_claimed");

  await db.from("tasks").update({ status: "expired" }).eq("id", taskId);
  await adjustCredits(requesterId, task.reward, "task_refund", { taskId });

  return { refunded: task.reward };
}

export interface ClaimResult {
  task: TaskRow;
  expiresAt: string;
  creditsRemaining: number;
}

export async function claimTask(taskId: string, agentId: string): Promise<ClaimResult> {
  const db = getDB();
  let { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) throw new Error("task_not_found");
  task = await releaseIfExpired(task as TaskRow);

  if (task.status !== "open") throw new Error("task_not_open");

  const agent = await resolveById(agentId);
  if (!agent) throw new Error("agent_not_found");
  if (agent.credits < CLAIM_COST) throw new Error("insufficient_credits");

  const expiresAt = new Date(Date.now() + CLAIM_WINDOW_MS).toISOString();
  const { data: updated, error } = await db
    .from("tasks")
    .update({ status: "claimed", claimed_by: agentId, claimed_at: new Date().toISOString(), expires_at: expiresAt })
    .eq("id", taskId)
    .eq("status", "open") // optimistic concurrency: only wins if still open
    .select()
    .single();

  if (error || !updated) throw new Error("task_claimed_by_another_agent");

  const creditsRemaining = await adjustCredits(agentId, -CLAIM_COST, "task_claim", { taskId });

  return { task: updated as TaskRow, expiresAt, creditsRemaining };
}

export interface CompleteResult {
  creditsEarned: number;
  feeCharged: number;
  chainBonus: number;
  creditsTotal: number;
  powHash: string;
  chainLength: number;
}

export async function completeTask(taskId: string, agentId: string, result: string): Promise<CompleteResult> {
  const db = getDB();
  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) throw new Error("task_not_found");
  if (task.claimed_by !== agentId) throw new Error("task_not_yours");
  if (task.status !== "claimed") throw new Error("task_not_claimed");
  if (task.expires_at && new Date(task.expires_at).getTime() < Date.now()) {
    await db.from("tasks").update({ status: "open", claimed_by: null, claimed_at: null, expires_at: null }).eq("id", taskId);
    throw new Error("task_expired");
  }

  await db
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString(), result: result.slice(0, 10000) })
    .eq("id", taskId);

  const fee = Math.floor(task.reward * TASK_FEE_RATE);
  const netReward = task.reward - fee;

  await adjustCredits(agentId, netReward, "task_complete", { taskId, taskTitle: task.title, fee });
  if (fee > 0) {
    await adjustCredits(PLATFORM_TREASURY_ID, fee, "task_fee", { taskId, agentId });
  }
  await mirrorCreditToOperator(agentId, netReward);

  const pow = await generatePoW(agentId, taskId, result);
  const { length: chainLength } = await verifyPoWChain(agentId);
  const chainBonus = powChainCreditBonus(chainLength);

  let creditsTotal: number;
  if (chainBonus > 0) {
    creditsTotal = await adjustCredits(agentId, chainBonus, "chain_bonus", { taskId, chainLength });
    await mirrorCreditToOperator(agentId, chainBonus);
  } else {
    const agent = await resolveById(agentId);
    creditsTotal = agent?.credits ?? 0;
  }

  const { data: agentRow } = await db.from("participants").select("tasks_completed").eq("id", agentId).single();
  await db.from("participants").update({ tasks_completed: (agentRow?.tasks_completed ?? 0) + 1 }).eq("id", agentId);

  return { creditsEarned: netReward + chainBonus, feeCharged: fee, chainBonus, creditsTotal, powHash: pow.hash, chainLength };
}

export async function listOpenTasks(category?: string, minReward?: number): Promise<TaskRow[]> {
  const db = getDB();
  let query = db.from("tasks").select("*").eq("status", "open").order("created_at", { ascending: false });
  if (category) query = query.eq("category", category);
  if (minReward) query = query.gte("reward", minReward);
  const { data } = await query;
  return (data ?? []) as TaskRow[];
}
