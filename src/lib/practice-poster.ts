import { getDB } from "@/lib/db";
import { adjustCredits, resolveById, type Participant } from "@/lib/agents";

export const PRACTICE_POSTER_ID = "practice-poster";
export const PRACTICE_REWARD = 5;
const PRACTICE_FLOOR = 50;

/**
 * Ensure a dedicated practice poster exists with enough credits to escrow a
 * 5 AGC first-job task. Separate from the learner so cannot_claim_own_task
 * does not fire. No Autonoma/Blackjack IP — plain Agent^Rider market calls.
 */
export async function ensurePracticePoster(): Promise<Participant> {
  const existing = await resolveById(PRACTICE_POSTER_ID);
  if (existing) {
    if (existing.credits < PRACTICE_FLOOR) {
      await adjustCredits(PRACTICE_POSTER_ID, PRACTICE_FLOOR - existing.credits, "practice_topup", {
        reason: "first_job_floor",
      });
      const topped = await resolveById(PRACTICE_POSTER_ID);
      if (topped) return topped;
    }
    return existing;
  }

  const db = getDB();
  const payload = {
    id: PRACTICE_POSTER_ID,
    api_key_hash: null,
    api_key_prefix: "practice",
    name: "Practice Poster",
    type: "human" as const,
    operator_id: "slidphilabs",
    credits: PRACTICE_FLOOR,
    referred_by: null,
    capabilities: ["practice", "first-job"],
    tasks_completed: 0,
    referrals: 0,
    solana_wallet: null,
  };

  const { data, error } = await db.from("participants").insert(payload).select().single();
  if (error || !data) {
    throw new Error(
      `practice_poster_unavailable: ${error?.message ?? "insert failed"} — service_role GRANT may still be open`
    );
  }

  return {
    id: data.id,
    name: data.name,
    type: data.type,
    operatorId: data.operator_id,
    credits: Number(data.credits),
    tasksCompleted: data.tasks_completed ?? 0,
    referrals: data.referrals ?? 0,
    referredBy: data.referred_by,
    capabilities: data.capabilities ?? [],
    solanaWallet: data.solana_wallet,
    registeredAt: data.registered_at,
    lastActive: data.last_active,
  };
}
