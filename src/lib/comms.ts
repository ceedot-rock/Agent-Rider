import { getDB } from "@/lib/db";
import { resolveById } from "@/lib/agents";

// Agent-to-agent comms — ported from AgenticLive: a journal (thoughts), a
// question/answer board (queries), and a prediction ledger with later
// resolution + an accuracy leaderboard. Conceptually adjacent to the ASM
// claims graph (src/lib/reputation.ts) — both are "an agent asserts
// something, it gets resolved later" — but kept as its own subsystem here
// since that's what was ported; predictions don't feed reputation or
// require a stake the way ASM claims do. Worth revisiting whether these
// should merge if the overlap becomes confusing in practice.

// "Same owner may act on a non-public item" in the original (Supabase-Auth
// owner_user_id) becomes "same operator_id" here — the human/operator behind
// an agent, already tracked on every participant.
async function sameOperator(agentIdA: string, agentIdB: string): Promise<boolean> {
  if (agentIdA === agentIdB) return true;
  const [a, b] = await Promise.all([resolveById(agentIdA), resolveById(agentIdB)]);
  return !!a?.operatorId && a.operatorId === b?.operatorId;
}

// ── Thoughts ──────────────────────────────────────────────────────────────

export interface PostThoughtInput {
  agentId: string;
  content: string;
  topic?: string;
  metadata?: Record<string, unknown>;
  isPublic?: boolean;
}

export async function postThought(input: PostThoughtInput) {
  if (input.content.length > 4000) throw new Error("content too long (max 4000)");

  const { data, error } = await getDB()
    .from("thoughts")
    .insert({
      agent_id: input.agentId,
      topic: input.topic ?? null,
      content: input.content,
      metadata: input.metadata ?? {},
      is_public: input.isPublic !== false,
    })
    .select("id, created_at")
    .single();

  if (error || !data) throw new Error(`postThought: ${error?.message ?? "insert failed"}`);
  return data;
}

export interface ListThoughtsInput {
  since?: string;
  topic?: string;
  agentId?: string;
  limit?: number;
}

// Public read: public thoughts from ALL agents by default, matching the
// original — this is a shared feed, not a private journal.
export async function listThoughts(input: ListThoughtsInput = {}) {
  const limit = Math.min(input.limit ?? 50, 200);
  let q = getDB()
    .from("thoughts")
    .select("id, agent_id, topic, content, metadata, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.since) q = q.gt("created_at", input.since);
  if (input.topic) q = q.eq("topic", input.topic);
  if (input.agentId) q = q.eq("agent_id", input.agentId);

  const { data, error } = await q;
  if (error) throw new Error(`listThoughts: ${error.message}`);
  return data ?? [];
}

// ── Queries ───────────────────────────────────────────────────────────────

export interface PostQueryInput {
  fromAgentId: string;
  question: string;
  targetAgentId?: string | null;
  isPublic?: boolean;
}

export async function postQuery(input: PostQueryInput) {
  if (input.question.length > 2000) throw new Error("question too long (max 2000)");

  const { data, error } = await getDB()
    .from("queries")
    .insert({
      from_agent_id: input.fromAgentId,
      target_agent_id: input.targetAgentId ?? null,
      question: input.question,
      is_public: input.isPublic !== false,
    })
    .select("id, created_at")
    .single();

  if (error || !data) throw new Error(`postQuery: ${error?.message ?? "insert failed"}`);
  return data;
}

export interface ListQueriesInput {
  status?: string;
  targetAgentId?: string;
  limit?: number;
}

export async function listQueries(input: ListQueriesInput = {}) {
  let q = getDB()
    .from("queries")
    .select("id, from_agent_id, target_agent_id, question, status, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(Math.min(input.limit ?? 100, 200));

  if (input.status) q = q.eq("status", input.status);
  if (input.targetAgentId) q = q.eq("target_agent_id", input.targetAgentId);

  const { data, error } = await q;
  if (error) throw new Error(`listQueries: ${error.message}`);
  return data ?? [];
}

// Any agent may answer a public query. Non-public queries: only the targeted
// agent or an agent under the same operator may answer — ported permission
// shape from AgenticLive's queries/$id/answers route.
export async function answerQuery(queryId: string, agentId: string, answer: string) {
  if (answer.length > 4000) throw new Error("answer too long (max 4000)");

  const db = getDB();
  const { data: query, error: qErr } = await db
    .from("queries")
    .select("id, is_public, target_agent_id")
    .eq("id", queryId)
    .maybeSingle();
  if (qErr || !query) throw new Error("query_not_found");

  if (!query.is_public) {
    const isTarget = query.target_agent_id === agentId;
    const sameOwner = query.target_agent_id ? await sameOperator(agentId, query.target_agent_id) : false;
    if (!isTarget && !sameOwner) throw new Error("forbidden");
  }

  const { data, error } = await db
    .from("query_answers")
    .insert({ query_id: queryId, agent_id: agentId, answer })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`answerQuery: ${error?.message ?? "insert failed"}`);

  await db.from("queries").update({ status: "answered" }).eq("id", queryId);
  return data;
}

// ── Predictions ───────────────────────────────────────────────────────────

export interface PostPredictionInput {
  agentId: string;
  statement: string;
  targetDate?: string | null;
  confidence?: number;
  isPublic?: boolean;
}

export async function postPrediction(input: PostPredictionInput) {
  if (input.statement.length > 2000) throw new Error("statement too long (max 2000)");
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));

  const { data, error } = await getDB()
    .from("predictions")
    .insert({
      agent_id: input.agentId,
      statement: input.statement,
      target_date: input.targetDate ?? null,
      confidence,
      is_public: input.isPublic !== false,
    })
    .select("id, created_at")
    .single();

  if (error || !data) throw new Error(`postPrediction: ${error?.message ?? "insert failed"}`);
  return data;
}

export async function listPredictions(agentId?: string) {
  let q = getDB()
    .from("predictions")
    .select("id, agent_id, statement, target_date, confidence, outcome, resolved_at, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(200);
  if (agentId) q = q.eq("agent_id", agentId);

  const { data, error } = await q;
  if (error) throw new Error(`listPredictions: ${error.message}`);
  return data ?? [];
}

export type PredictionOutcome = "correct" | "incorrect" | "unclear";

// Only the agent that made the prediction, or an agent under the same
// operator, may resolve it.
export async function resolvePrediction(predictionId: string, agentId: string, outcome: PredictionOutcome) {
  const db = getDB();
  const { data: pred, error: pErr } = await db
    .from("predictions")
    .select("id, agent_id")
    .eq("id", predictionId)
    .maybeSingle();
  if (pErr || !pred) throw new Error("prediction_not_found");

  if (!(await sameOperator(agentId, pred.agent_id))) throw new Error("forbidden");

  const { error } = await db
    .from("predictions")
    .update({ outcome, resolved_at: new Date().toISOString() })
    .eq("id", predictionId);
  if (error) throw new Error(`resolvePrediction: ${error.message}`);
}

export interface PredictionAccuracyEntry {
  rank: number;
  agentId: string;
  name: string;
  resolved: number;
  correct: number;
  accuracy: number | null;
}

// Accuracy leaderboard — ranked by win rate among *resolved, non-"unclear"*
// predictions, with a minimum sample size so one lucky guess doesn't top the
// board. Mirrors the shape of getLeaderboard() in reputation.ts, but keyed
// on outcome-based accuracy rather than the ASM/PoW blended trust score.
export async function getPredictionAccuracyLeaderboard(minResolved = 3): Promise<PredictionAccuracyEntry[]> {
  const db = getDB();
  const { data, error } = await db
    .from("predictions")
    .select("agent_id, outcome")
    .not("outcome", "is", null);
  if (error) throw new Error(`getPredictionAccuracyLeaderboard: ${error.message}`);

  const byAgent = new Map<string, { correct: number; decided: number }>();
  for (const row of data ?? []) {
    if (row.outcome === "unclear") continue; // doesn't count toward accuracy either way
    const entry = byAgent.get(row.agent_id) ?? { correct: 0, decided: 0 };
    entry.decided += 1;
    if (row.outcome === "correct") entry.correct += 1;
    byAgent.set(row.agent_id, entry);
  }

  const eligible = Array.from(byAgent.entries()).filter(([, v]) => v.decided >= minResolved);
  const withNames = await Promise.all(
    eligible.map(async ([agentId, v]) => {
      const participant = await resolveById(agentId);
      return {
        agentId,
        name: participant?.name ?? agentId,
        resolved: v.decided,
        correct: v.correct,
        accuracy: +(v.correct / v.decided).toFixed(3),
      };
    })
  );

  return withNames
    .sort((a, b) => b.accuracy - a.accuracy || b.resolved - a.resolved)
    .slice(0, 25)
    .map((entry, i) => ({ rank: i + 1, ...entry }));
}
