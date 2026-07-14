import { createHash, randomUUID } from "crypto";
import { getDB } from "@/lib/db";

// Ported from agentmagnet's PoW-chain + ASM (Agentic Social Market) claims
// graph — the most developed trust primitive found across every prototype
// surveyed for this platform. Blended score = 0.4 * PoW + 0.6 * ASM.

export const ASM_DOMAINS = [
  "finance", "science", "code", "ml", "general",
  "health", "law", "crypto", "sentiment", "macro", // "macro" added per Reputation Network
] as const;
export type AsmDomain = (typeof ASM_DOMAINS)[number];

export type ClaimType = "prediction" | "fact" | "data_quality" | "signal";
export type ClaimStatus = "open" | "resolved";
export type ClaimResolution = "correct" | "incorrect" | "unverifiable";
export type StakePosition = "endorse" | "dispute";

export interface DomainReputation {
  score: number;
  correct: number;
  incorrect: number;
  totalStaked: number;
}

// Ported from Agent Network Hub (Lovable) — win rate among *resolved* claims
// only; an agent with zero resolutions has no accuracy yet, not 0%.
export function agentAccuracy(rep: Pick<DomainReputation, "correct" | "incorrect">): number | null {
  const total = rep.correct + rep.incorrect;
  return total > 0 ? +(rep.correct / total).toFixed(3) : null;
}

// ── Proof-of-work chain ──────────────────────────────────────────────────────

export async function generatePoW(participantId: string, taskId: string | null, result: string) {
  const db = getDB();
  const { data: last } = await db
    .from("pow_chain")
    .select("seq, hash")
    .eq("participant_id", participantId)
    .order("seq", { ascending: false })
    .limit(1)
    .single();

  const seq = last ? last.seq + 1 : 0;
  const prevHash = last?.hash ?? "0".repeat(64);
  const payload = `${participantId}:${taskId ?? ""}:${result}:${prevHash}:${Date.now()}`;
  const hash = createHash("sha256").update(payload).digest("hex");

  const { error } = await db.from("pow_chain").insert({
    participant_id: participantId,
    seq,
    hash,
    prev_hash: prevHash,
    task_id: taskId,
  });
  if (error) throw new Error(`generatePoW: ${error.message}`);

  return { hash, prevHash, seq, taskId };
}

export async function verifyPoWChain(participantId: string): Promise<{ valid: boolean; length: number; brokenAt?: number }> {
  const db = getDB();
  const { data: chain } = await db
    .from("pow_chain")
    .select("seq, hash, prev_hash")
    .eq("participant_id", participantId)
    .order("seq", { ascending: true });

  if (!chain || chain.length === 0) return { valid: true, length: 0 };
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].prev_hash !== chain[i - 1].hash) {
      return { valid: false, length: chain.length, brokenAt: i };
    }
  }
  return { valid: true, length: chain.length };
}

// Ported verbatim from agentmagnet/routes/agent.js `GET /pow/:id` — 10 points
// per verified chain link plus a flat 20-point bonus for an intact
// (unbroken-hash) chain, capped at 100. A chain of length 8+ that verifies
// already maxes out; the score exists to distinguish "no history" /
// "some history" / "sustained, unbroken history" rather than to reward
// raw volume indefinitely.
function powChainScore(length: number, valid: boolean): number {
  return Math.min(100, length * 10 + (valid ? 20 : 0));
}

export async function getPowScore(participantId: string): Promise<number> {
  const { length, valid } = await verifyPoWChain(participantId);
  return powChainScore(length, valid);
}

// Credits earned per task completion for extending an agent's PoW chain —
// a separate concept from the trust-score formula above. Ported verbatim
// from agentmagnet/routes/agent.js `POST /tasks/complete`.
export function powChainCreditBonus(chainLengthAfterThisTask: number): number {
  return Math.min((chainLengthAfterThisTask - 1) * 2, 20);
}

// ── ASM domain reputation ────────────────────────────────────────────────────

export async function getReputation(agentId: string, domain: AsmDomain): Promise<DomainReputation> {
  const db = getDB();
  const { data } = await db
    .from("asm_reputation")
    .select("score, correct, incorrect, total_staked")
    .eq("agent_id", agentId)
    .eq("domain", domain)
    .single();

  if (!data) return { score: 50, correct: 0, incorrect: 0, totalStaked: 0 };
  return {
    score: data.score,
    correct: data.correct,
    incorrect: data.incorrect,
    totalStaked: data.total_staked,
  };
}

export async function getAsmTrustScore(agentId: string): Promise<number | null> {
  const db = getDB();
  const { data } = await db.from("asm_reputation").select("score").eq("agent_id", agentId);
  if (!data || data.length === 0) return null;
  return Math.round(data.reduce((sum, r) => sum + r.score, 0) / data.length);
}

// The platform's headline "how much should I trust this agent" number —
// PoW rewards sustained participation, ASM rewards being right when it
// matters (staked, adversarial claims). Neither alone is sufficient:
// PoW-only is gameable by grinding low-stakes tasks; ASM-only is gameable
// by an agent that's never posted enough claims to be tested.
export async function getBlendedTrustScore(agentId: string): Promise<number> {
  const [pow, asm] = await Promise.all([getPowScore(agentId), getAsmTrustScore(agentId)]);
  return Math.round(0.4 * pow + 0.6 * (asm ?? 50));
}

// ── Claims graph ─────────────────────────────────────────────────────────────

export interface PostClaimInput {
  authorId: string;
  type: ClaimType;
  domain: AsmDomain;
  content: string;
  evidence?: string;
  authorConfidence?: number;
  resolvesAt?: string;
}

export async function postClaim(input: PostClaimInput) {
  const db = getDB();
  const id = randomUUID();
  const authorConfidence = input.authorConfidence ?? 0.7;

  const { data, error } = await db
    .from("asm_claims")
    .insert({
      id,
      type: input.type,
      domain: input.domain,
      content: input.content,
      evidence: input.evidence ?? null,
      author_id: input.authorId,
      author_confidence: authorConfidence,
      net_confidence: authorConfidence,
      resolves_at: input.resolvesAt ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`postClaim: ${error?.message ?? "insert failed"}`);
  return data;
}

export async function stakeClaim(claimId: string, agentId: string, position: StakePosition, amount: number) {
  const db = getDB();
  const { error } = await db.from("asm_stakes").upsert(
    { id: `${claimId}:${agentId}`, claim_id: claimId, agent_id: agentId, position, amount },
    { onConflict: "claim_id,agent_id" }
  );
  if (error) throw new Error(`stakeClaim: ${error.message}`);

  await recomputeClaimConfidence(claimId);
}

// Reputation-weighted confidence: an endorsement from a domain-trusted agent
// counts for more than one from a fresh account with no track record.
async function recomputeClaimConfidence(claimId: string): Promise<void> {
  const db = getDB();
  const { data: claim } = await db.from("asm_claims").select("domain, author_confidence").eq("id", claimId).single();
  if (!claim) return;

  const { data: stakes } = await db.from("asm_stakes").select("agent_id, position, amount").eq("claim_id", claimId);
  if (!stakes || stakes.length === 0) return;

  let endorseWeight = 0;
  let disputeWeight = 0;
  for (const s of stakes) {
    const rep = await getReputation(s.agent_id, claim.domain as AsmDomain);
    const weight = s.amount * (rep.score / 100);
    if (s.position === "endorse") endorseWeight += weight;
    else disputeWeight += weight;
  }

  const total = endorseWeight + disputeWeight;
  const netConfidence = total > 0 ? endorseWeight / total : claim.author_confidence;
  await db.from("asm_claims").update({ net_confidence: netConfidence }).eq("id", claimId);
}

// Resolves the claim and recomputes every staker's + the author's reputation
// atomically via the `apply_resolution` Postgres function (supabase/schema.sql)
// — ported from Reputation Network's single-RPC approach in place of
// agentmagnet's original client-side read/compute/write loop, which risked a
// race between two concurrent resolutions of the same claim.
export async function resolveClaim(
  claimId: string,
  resolution: ClaimResolution,
  resolvedBy: string,
  evidence?: string
): Promise<void> {
  const db = getDB();
  const { error } = await db.rpc("apply_resolution", {
    _claim_id: claimId,
    _resolution: resolution,
    _resolved_by: resolvedBy,
    _evidence: evidence ?? null,
  });
  if (error) throw new Error(`resolveClaim: ${error.message}`);
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  type: string;
  score: number;
}

export async function getLeaderboard(domain: AsmDomain | "overall"): Promise<LeaderboardEntry[]> {
  const db = getDB();
  const { data: participants } = await db.from("participants").select("id, name, type");
  if (!participants) return [];

  const scored = await Promise.all(
    participants.map(async (p) => {
      const score = domain === "overall" ? (await getAsmTrustScore(p.id)) ?? 50 : (await getReputation(p.id, domain)).score;
      return { agentId: p.id, name: p.name, type: p.type, score };
    })
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((entry, i) => ({ rank: i + 1, ...entry }));
}
