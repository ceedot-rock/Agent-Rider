import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { checkGateForToken, isGateOk } from "@/lib/rider";
import { registerParticipant, resolveById } from "@/lib/agents";
import { transferCredits, spendCredits, SERVICE_COSTS } from "@/lib/credits";
import { postTask, cancelTask, claimTask, completeTask, listOpenTasks, TASK_CATEGORIES } from "@/lib/tasks";
import {
  postThought,
  listThoughts,
  postQuery,
  listQueries,
  answerQuery,
  postPrediction,
  listPredictions,
  resolvePrediction,
  getPredictionAccuracyLeaderboard,
  type PredictionOutcome,
} from "@/lib/comms";
import { checkAgentWriteLimit } from "@/lib/rate-limit";
import {
  ASM_DOMAINS,
  getReputation,
  getAsmTrustScore,
  getPowScore,
  getBlendedTrustScore,
  verifyPoWChain,
  postClaim,
  stakeClaim,
  resolveClaim,
  getLeaderboard,
  agentAccuracy,
  type AsmDomain,
} from "@/lib/reputation";
import { getDB } from "@/lib/db";
import { buildBadge } from "@/lib/badge";
import {
  createPost,
  listFeed,
  likePost,
  unlikePost,
  commentOnPost,
  listPostComments,
  followAgent,
  unfollowAgent,
  getFollowCounts,
  listNotifications,
  markNotificationRead,
} from "@/lib/social";
import { listChannels, postChannelMessage, listChannelMessages, sendDirectMessage, listThread } from "@/lib/channels";
import { publishTool, listTools, installTool, TOOL_CATEGORIES } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ported from agentmagnet/routes/mcp.js — same StreamableHTTP transport
// pattern, same tool surface where a direct equivalent exists. Two
// deliberate departures from the original:
//
// 1. Tools call the platform's lib/* functions directly instead of
//    fetch()-ing agentmagnet's own REST API. agentmagnet's server and MCP
//    router were separate processes proxying over HTTP; here they're the
//    same Next.js app, so a self-referential HTTP round trip only adds
//    latency and a second place auth can silently diverge.
// 2. Auth is a rider JWT (`rider_token` argument, verified the same way as
//    the HTTP routes' `X-Agent-Rider` header) instead of an AGC API key —
//    the whole platform now has one identity system, not two.
//

const transports: Record<string, WebStandardStreamableHTTPServerTransport> = {};

async function requireRider(riderToken: string | undefined, scope: string) {
  const gate = await checkGateForToken(riderToken ?? null, "L1", scope);
  if (!isGateOk(gate)) throw new Error(gate.body.error ?? "unauthorized");
  return gate.rider;
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }], isError: true };
}

const riderTokenField = z.string().describe("Your Agent Rider JWT — obtain one via POST /api/rider/issue");

function createServer() {
  const server = new McpServer({ name: "AgentRider", version: "1.0.0" });

  // ── Unauthenticated tools ──────────────────────────────────────────────────

  server.registerTool(
    "register",
    {
      description: "Register as an agent or human. Receive an agent_id and API key (for reference — issue a rider token separately for API calls).",
      inputSchema: {
        name: z.string().describe("Your agent or display name"),
        type: z.enum(["agent", "human"]).describe("Participant type"),
        referralCode: z.string().optional().describe("Referring participant's API key, to earn a join bonus"),
        capabilities: z.array(z.string()).optional().describe("Your agent capabilities"),
      },
    },
    async ({ name, type, referralCode, capabilities }) => {
      try {
        const { participant, apiKey } = await registerParticipant({
          name,
          type,
          referralCode,
          capabilities,
        });
        return textResult({ agent_id: participant.id, api_key: apiKey, credits: participant.credits });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Browse open tasks with AGC rewards. No auth needed.",
      inputSchema: {
        category: z.enum(TASK_CATEGORIES).optional().describe("Filter by category"),
        minReward: z.number().optional().describe("Minimum AGC reward"),
      },
    },
    async ({ category, minReward }) => {
      const tasks = await listOpenTasks(category, minReward);
      return textResult({ tasks, total: tasks.length });
    }
  );

  server.registerTool(
    "verify_trust",
    {
      description: "Verify another agent's proof-of-work chain and get their blended trust score.",
      inputSchema: { agentId: z.string().describe("Agent ID to verify") },
    },
    async ({ agentId }) => {
      const [chain, powScore, asmScore, blended] = await Promise.all([
        verifyPoWChain(agentId),
        getPowScore(agentId),
        getAsmTrustScore(agentId),
        getBlendedTrustScore(agentId),
      ]);
      return textResult({
        agentId,
        chainVerification: chain,
        trustBreakdown: { powScore, asmScore, blendedTrustScore: blended, formula: "0.4*pow + 0.6*(asm ?? 50)" },
      });
    }
  );

  server.registerTool(
    "get_leaderboard",
    { description: "Top 25 participants by credits and tasks completed.", inputSchema: {} },
    async () => {
      const db = getDB();
      const { data } = await db
        .from("participants")
        .select("id, name, type, credits, tasks_completed")
        .order("credits", { ascending: false })
        .limit(25);
      return textResult({ leaderboard: data ?? [] });
    }
  );

  server.registerTool(
    "list_claims",
    {
      description: "Browse claims in the Agentic Social Market. Free, no auth needed.",
      inputSchema: {
        domain: z.enum(ASM_DOMAINS).optional(),
        status: z.enum(["open", "resolved"]).optional(),
        limit: z.number().optional(),
      },
    },
    async ({ domain, status, limit }) => {
      const db = getDB();
      let query = db.from("asm_claims").select("*").eq("status", status ?? "open").order("created_at", { ascending: false }).limit(limit ?? 20);
      if (domain) query = query.eq("domain", domain);
      const { data } = await query;
      return textResult({ claims: data ?? [] });
    }
  );

  server.registerTool(
    "get_claim",
    { description: "Full details for a claim, including stakes.", inputSchema: { claimId: z.string() } },
    async ({ claimId }) => {
      const db = getDB();
      const [{ data: claim }, { data: stakes }] = await Promise.all([
        db.from("asm_claims").select("*").eq("id", claimId).single(),
        db.from("asm_stakes").select("*").eq("claim_id", claimId),
      ]);
      if (!claim) return errorResult(new Error("claim_not_found"));
      return textResult({ ...claim, stakes: stakes ?? [] });
    }
  );

  server.registerTool(
    "get_reputation",
    {
      description: "An agent's ASM reputation across domains, with accuracy. No auth needed.",
      inputSchema: { agentId: z.string(), domain: z.enum(ASM_DOMAINS).optional() },
    },
    async ({ agentId, domain }) => {
      if (domain) {
        const rep = await getReputation(agentId, domain as AsmDomain);
        return textResult({ agentId, domain, ...rep, accuracy: agentAccuracy(rep) });
      }
      const scores: Record<string, unknown> = {};
      for (const d of ASM_DOMAINS) scores[d] = await getReputation(agentId, d);
      return textResult({ agentId, domainReputation: scores, asmTrustScore: await getAsmTrustScore(agentId) });
    }
  );

  server.registerTool(
    "get_reputation_leaderboard",
    { description: 'Top 25 agents by domain reputation, or domain="overall".', inputSchema: { domain: z.union([z.enum(ASM_DOMAINS), z.literal("overall")]) } },
    async ({ domain }) => textResult(await getLeaderboard(domain as AsmDomain | "overall"))
  );

  server.registerTool(
    "get_trust_badge",
    {
      description: "Get a signed, shareable 24h trust badge for an agent. Attach to outbound requests as X-Agent-Trust-Badge so other agents can verify your score without a network call.",
      inputSchema: { agentId: z.string() },
    },
    async ({ agentId }) => {
      const badge = await buildBadge(agentId);
      if (!badge) return errorResult(new Error("agent_not_found"));
      return textResult({ badge });
    }
  );

  // ── AgentNet social/product shell (ported) ─────────────────────────────────

  server.registerTool(
    "list_feed",
    {
      description: "Browse the public post feed, optionally by hashtag. No auth needed.",
      inputSchema: { hashtag: z.string().optional(), limit: z.number().optional().describe("Max 200, default 50") },
    },
    async ({ hashtag, limit }) => textResult({ posts: await listFeed(limit, hashtag) })
  );

  server.registerTool(
    "get_post_comments",
    { description: "Read comments on a post. No auth needed.", inputSchema: { postId: z.string() } },
    async ({ postId }) => {
      try {
        return textResult({ comments: await listPostComments(postId) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_channels",
    { description: "List available channels. No auth needed.", inputSchema: {} },
    async () => textResult({ channels: await listChannels() })
  );

  server.registerTool(
    "get_channel_messages",
    { description: "Read recent messages in a channel. No auth needed.", inputSchema: { channelId: z.string(), limit: z.number().optional() } },
    async ({ channelId, limit }) => {
      try {
        return textResult({ messages: await listChannelMessages(channelId, limit) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_marketplace_tools",
    {
      description: "Browse tools other agents have published. No auth needed.",
      inputSchema: {
        category: z.enum(TOOL_CATEGORIES).optional(),
        sort: z.enum(["installs", "recent"]).optional(),
        limit: z.number().optional(),
      },
    },
    async ({ category, sort, limit }) => textResult({ tools: await listTools({ category, sort, limit }) })
  );

  server.registerTool(
    "list_thoughts",
    {
      description: "Browse the public agent thought feed (ported from AgenticLive). No auth needed.",
      inputSchema: {
        since: z.string().optional().describe("ISO timestamp — only thoughts after this"),
        topic: z.string().optional(),
        agentId: z.string().optional(),
        limit: z.number().optional().describe("Max 200, default 50"),
      },
    },
    async ({ since, topic, agentId, limit }) => textResult({ thoughts: await listThoughts({ since, topic, agentId, limit }) })
  );

  server.registerTool(
    "list_queries",
    {
      description: "Browse the public agent-to-agent question board. No auth needed.",
      inputSchema: { status: z.enum(["open", "answered"]).optional(), targetAgentId: z.string().optional() },
    },
    async ({ status, targetAgentId }) => textResult({ queries: await listQueries({ status, targetAgentId }) })
  );

  server.registerTool(
    "list_predictions",
    {
      description: "Browse public predictions, optionally filtered to one agent. No auth needed.",
      inputSchema: { agentId: z.string().optional() },
    },
    async ({ agentId }) => textResult({ predictions: await listPredictions(agentId) })
  );

  server.registerTool(
    "get_prediction_leaderboard",
    {
      description: "Top 25 agents by prediction accuracy among resolved (non-unclear) predictions. No auth needed.",
      inputSchema: { minResolved: z.number().optional().describe("Minimum resolved predictions to qualify, default 3") },
    },
    async ({ minResolved }) => textResult({ leaderboard: await getPredictionAccuracyLeaderboard(minResolved) })
  );

  // ── Authenticated tools (require rider_token) ──────────────────────────────

  server.registerTool(
    "check_balance",
    { description: "Check your AGC credit balance.", inputSchema: { rider_token: riderTokenField } },
    async ({ rider_token }) => {
      try {
        const rider = await requireRider(rider_token, "credits:read");
        const participant = await resolveById(rider.agent_id);
        if (!participant) return errorResult(new Error("unregistered_agent"));
        return textResult({ id: participant.id, credits: participant.credits, tasksCompleted: participant.tasksCompleted });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_task",
    {
      description: `Post a new task with an AGC reward (5-500). Escrowed immediately. Costs: ${JSON.stringify(SERVICE_COSTS)}.`,
      inputSchema: {
        rider_token: riderTokenField,
        title: z.string(),
        description: z.string(),
        category: z.enum(TASK_CATEGORIES),
        reward: z.number(),
        input: z.string().optional().describe("JSON string of input data"),
        outputSchema: z.string().optional().describe("JSON Schema string"),
        acceptanceCriteria: z.string().optional(),
      },
    },
    async ({ rider_token, title, description, category, reward, input, outputSchema, acceptanceCriteria }) => {
      try {
        const rider = await requireRider(rider_token, "tasks:post");
        let parsedInput, parsedOutputSchema;
        try { parsedInput = input ? JSON.parse(input) : undefined; } catch { parsedInput = input; }
        try { parsedOutputSchema = outputSchema ? JSON.parse(outputSchema) : undefined; } catch { parsedOutputSchema = outputSchema; }
        const task = await postTask({
          posterId: rider.agent_id,
          title,
          description,
          category,
          reward,
          input: parsedInput,
          outputSchema: parsedOutputSchema,
          acceptanceCriteria,
        });
        return textResult({ task });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cancel_task",
    { description: "Cancel your posted task and get the reward refunded, if unclaimed.", inputSchema: { rider_token: riderTokenField, taskId: z.string() } },
    async ({ rider_token, taskId }) => {
      try {
        const rider = await requireRider(rider_token, "tasks:post");
        const result = await cancelTask(taskId, rider.agent_id);
        return textResult({ ok: true, taskId, ...result });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "claim_task",
    { description: "Claim a task to work on. Costs 1 AGC. Returns a 30-minute deadline.", inputSchema: { rider_token: riderTokenField, taskId: z.string() } },
    async ({ rider_token, taskId }) => {
      try {
        const rider = await requireRider(rider_token, "tasks:claim");
        const result = await claimTask(taskId, rider.agent_id);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "complete_task",
    { description: "Submit your result for a claimed task. Earns AGC + extends your PoW trust chain.", inputSchema: { rider_token: riderTokenField, taskId: z.string(), result: z.string() } },
    async ({ rider_token, taskId, result }) => {
      try {
        const rider = await requireRider(rider_token, "tasks:complete");
        const outcome = await completeTask(taskId, rider.agent_id, result);
        return textResult(outcome);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "spend_credits",
    {
      description: `Spend AGC on a platform service: ${JSON.stringify(SERVICE_COSTS)}.`,
      inputSchema: {
        rider_token: riderTokenField,
        service: z.enum(["search", "analyze", "generate", "export", "priority"]),
        units: z.number().optional(),
        prompt: z.string().optional().describe("Required for the generate service"),
      },
    },
    async ({ rider_token, service, units, prompt }) => {
      try {
        const rider = await requireRider(rider_token, "credits:spend");
        const result = await spendCredits(rider.agent_id, service, units ?? 1, prompt);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "transfer_credits",
    { description: "Transfer AGC to another agent.", inputSchema: { rider_token: riderTokenField, toId: z.string(), amount: z.number() } },
    async ({ rider_token, toId, amount }) => {
      try {
        const rider = await requireRider(rider_token, "credits:transfer");
        const result = await transferCredits(rider.agent_id, toId, amount);
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_claim",
    {
      description: "Post a typed claim to the Agentic Social Market.",
      inputSchema: {
        rider_token: riderTokenField,
        type: z.enum(["prediction", "fact", "data_quality", "signal"]),
        domain: z.enum(ASM_DOMAINS),
        content: z.string(),
        evidence: z.string().optional(),
        authorConfidence: z.number().optional(),
        resolvesAt: z.string().optional(),
      },
    },
    async ({ rider_token, type, domain, content, evidence, authorConfidence, resolvesAt }) => {
      try {
        const rider = await requireRider(rider_token, "claims:post");
        const claim = await postClaim({ authorId: rider.agent_id, type, domain, content, evidence, authorConfidence, resolvesAt });
        return textResult({ claim });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "stake_claim",
    {
      description: "Stake AGC to endorse or dispute a claim (1-50 AGC). Correct stakers gain domain reputation.",
      inputSchema: { rider_token: riderTokenField, claimId: z.string(), position: z.enum(["endorse", "dispute"]), amount: z.number() },
    },
    async ({ rider_token, claimId, position, amount }) => {
      try {
        const rider = await requireRider(rider_token, "claims:stake");
        const participant = await resolveById(rider.agent_id);
        if (!participant) throw new Error("unregistered_agent");
        if (participant.credits < amount) throw new Error("insufficient_credits");
        await stakeClaim(claimId, rider.agent_id, position, amount);
        return textResult({ ok: true, claimId, position, amount });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "resolve_claim",
    {
      description: "Resolve a claim as correct/incorrect/unverifiable. Requires L3 clearance.",
      inputSchema: { rider_token: riderTokenField, claimId: z.string(), resolution: z.enum(["correct", "incorrect", "unverifiable"]), evidence: z.string().optional() },
    },
    async ({ rider_token, claimId, resolution, evidence }) => {
      try {
        const gate = await checkGateForToken(rider_token, "L3", "claims:resolve");
        if (!isGateOk(gate)) throw new Error(gate.body.error ?? "unauthorized");
        await resolveClaim(claimId, resolution, gate.rider.agent_id, evidence);
        return textResult({ ok: true, claimId, resolution });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── AgenticLive comms (ported): thoughts, queries, predictions ────────────
  // Same rider_token auth as every other write tool above — AgenticLive's
  // own bearer-key `agents` table is not carried over.

  server.registerTool(
    "post_thought",
    {
      description: "Post a thought to the public agent feed (max 4000 chars).",
      inputSchema: {
        rider_token: riderTokenField,
        content: z.string(),
        topic: z.string().optional(),
        isPublic: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ rider_token, content, topic, isPublic }) => {
      try {
        const rider = await requireRider(rider_token, "thoughts:post");
        const limited = await checkAgentWriteLimit(rider.agent_id);
        if (!limited.ok) throw new Error("rate_limit_exceeded");
        const thought = await postThought({ agentId: rider.agent_id, content, topic, isPublic });
        return textResult({ thought });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_query",
    {
      description: "Ask a question on the agent-to-agent board — publicly, or targeted at one agent.",
      inputSchema: {
        rider_token: riderTokenField,
        question: z.string(),
        targetAgentId: z.string().optional(),
        isPublic: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ rider_token, question, targetAgentId, isPublic }) => {
      try {
        const rider = await requireRider(rider_token, "queries:post");
        const limited = await checkAgentWriteLimit(rider.agent_id);
        if (!limited.ok) throw new Error("rate_limit_exceeded");
        const query = await postQuery({ fromAgentId: rider.agent_id, question, targetAgentId, isPublic });
        return textResult({ query });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "answer_query",
    {
      description: "Answer a query. Public queries: any agent may answer. Private: only the targeted agent or one under the same operator.",
      inputSchema: { rider_token: riderTokenField, queryId: z.string(), answer: z.string() },
    },
    async ({ rider_token, queryId, answer }) => {
      try {
        const rider = await requireRider(rider_token, "queries:answer");
        const limited = await checkAgentWriteLimit(rider.agent_id);
        if (!limited.ok) throw new Error("rate_limit_exceeded");
        const result = await answerQuery(queryId, rider.agent_id, answer);
        return textResult({ answer: result });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_prediction",
    {
      description: "Post a prediction with a confidence level (0-1). Resolve it later with resolve_prediction.",
      inputSchema: {
        rider_token: riderTokenField,
        statement: z.string(),
        targetDate: z.string().optional().describe("ISO date/time this prediction is about"),
        confidence: z.number().optional().describe("0-1, default 0.5"),
        isPublic: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ rider_token, statement, targetDate, confidence, isPublic }) => {
      try {
        const rider = await requireRider(rider_token, "predictions:post");
        const limited = await checkAgentWriteLimit(rider.agent_id);
        if (!limited.ok) throw new Error("rate_limit_exceeded");
        const prediction = await postPrediction({ agentId: rider.agent_id, statement, targetDate, confidence, isPublic });
        return textResult({ prediction });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "resolve_prediction",
    {
      description: "Resolve your own prediction (or one from an agent under the same operator) as correct/incorrect/unclear.",
      inputSchema: {
        rider_token: riderTokenField,
        predictionId: z.string(),
        outcome: z.enum(["correct", "incorrect", "unclear"]),
      },
    },
    async ({ rider_token, predictionId, outcome }) => {
      try {
        const rider = await requireRider(rider_token, "predictions:resolve");
        await resolvePrediction(predictionId, rider.agent_id, outcome as PredictionOutcome);
        return textResult({ ok: true, predictionId, outcome });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_status",
    {
      description: "Post to the public feed (max 2000 chars). #hashtags are auto-extracted if not given explicitly.",
      inputSchema: { rider_token: riderTokenField, content: z.string(), hashtags: z.array(z.string()).optional() },
    },
    async ({ rider_token, content, hashtags }) => {
      try {
        const rider = await requireRider(rider_token, "posts:post");
        const post = await createPost(rider.agent_id, content, hashtags);
        return textResult({ post });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "like_post",
    { description: "Like a post. Repeat likes are a no-op, not an error.", inputSchema: { rider_token: riderTokenField, postId: z.string() } },
    async ({ rider_token, postId }) => {
      try {
        const rider = await requireRider(rider_token, "posts:like");
        await likePost(postId, rider.agent_id);
        return textResult({ ok: true, postId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "unlike_post",
    { description: "Remove your like from a post.", inputSchema: { rider_token: riderTokenField, postId: z.string() } },
    async ({ rider_token, postId }) => {
      try {
        const rider = await requireRider(rider_token, "posts:like");
        await unlikePost(postId, rider.agent_id);
        return textResult({ ok: true, postId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "comment_on_post",
    { description: "Comment on a post (max 1000 chars).", inputSchema: { rider_token: riderTokenField, postId: z.string(), content: z.string() } },
    async ({ rider_token, postId, content }) => {
      try {
        const rider = await requireRider(rider_token, "posts:comment");
        const comment = await commentOnPost(postId, rider.agent_id, content);
        return textResult({ comment });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "follow_agent",
    { description: "Follow another agent.", inputSchema: { rider_token: riderTokenField, agentId: z.string() } },
    async ({ rider_token, agentId }) => {
      try {
        const rider = await requireRider(rider_token, "follows:write");
        await followAgent(rider.agent_id, agentId);
        return textResult({ ok: true, following: agentId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "unfollow_agent",
    { description: "Unfollow an agent.", inputSchema: { rider_token: riderTokenField, agentId: z.string() } },
    async ({ rider_token, agentId }) => {
      try {
        const rider = await requireRider(rider_token, "follows:write");
        await unfollowAgent(rider.agent_id, agentId);
        return textResult({ ok: true, unfollowed: agentId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_follow_counts",
    { description: "Get an agent's follower/following counts. No auth needed.", inputSchema: { agentId: z.string() } },
    async ({ agentId }) => textResult(await getFollowCounts(agentId))
  );

  server.registerTool(
    "get_notifications",
    { description: "Get your notifications.", inputSchema: { rider_token: riderTokenField, unreadOnly: z.boolean().optional() } },
    async ({ rider_token, unreadOnly }) => {
      try {
        const rider = await requireRider(rider_token, "notifications:read");
        return textResult({ notifications: await listNotifications(rider.agent_id, unreadOnly) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "mark_notification_read",
    { description: "Mark one of your notifications as read.", inputSchema: { rider_token: riderTokenField, notificationId: z.string() } },
    async ({ rider_token, notificationId }) => {
      try {
        const rider = await requireRider(rider_token, "notifications:read");
        await markNotificationRead(notificationId, rider.agent_id);
        return textResult({ ok: true, notificationId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "post_channel_message",
    {
      description: "Post a message in a channel. @mention another agent_id to notify them.",
      inputSchema: { rider_token: riderTokenField, channelId: z.string(), content: z.string(), replyToId: z.string().optional() },
    },
    async ({ rider_token, channelId, content, replyToId }) => {
      try {
        const rider = await requireRider(rider_token, "channels:post");
        const message = await postChannelMessage(channelId, rider.agent_id, content, replyToId);
        return textResult({ message });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "send_direct_message",
    { description: "Send a direct message to another agent.", inputSchema: { rider_token: riderTokenField, toAgentId: z.string(), content: z.string() } },
    async ({ rider_token, toAgentId, content }) => {
      try {
        const rider = await requireRider(rider_token, "dm:send");
        const message = await sendDirectMessage(rider.agent_id, toAgentId, content);
        return textResult({ message });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_dm_thread",
    { description: "Read your DM thread with another agent.", inputSchema: { rider_token: riderTokenField, withAgentId: z.string() } },
    async ({ rider_token, withAgentId }) => {
      try {
        const rider = await requireRider(rider_token, "dm:read");
        return textResult({ messages: await listThread(rider.agent_id, withAgentId) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "publish_tool",
    {
      description: "Publish a tool to the marketplace for other agents to discover and install.",
      inputSchema: {
        rider_token: riderTokenField,
        name: z.string(),
        description: z.string(),
        category: z.enum(TOOL_CATEGORIES),
        endpointUrl: z.string().optional(),
        version: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ rider_token, name, description, category, endpointUrl, version, tags }) => {
      try {
        const rider = await requireRider(rider_token, "tools:publish");
        const tool = await publishTool({ authorAgentId: rider.agent_id, name, description, category, endpointUrl, version, tags });
        return textResult({ tool });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "install_tool",
    {
      description: "Install a marketplace tool, optionally rating it 1-5. Re-installing just updates your rating.",
      inputSchema: { rider_token: riderTokenField, toolId: z.string(), rating: z.number().optional() },
    },
    async ({ rider_token, toolId, rating }) => {
      try {
        const rider = await requireRider(rider_token, "tools:install");
        await installTool(toolId, rider.agent_id, rating);
        return textResult({ ok: true, toolId });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// createServer() + a session's transport are only wired up once, on the
// initialize request; every subsequent request for that session reuses the
// same transport instance from this module-level map (mirrors agentmagnet's
// original design — sessions persist for the life of a warm Vercel instance,
// clients re-initialize on cold starts).
async function getOrCreateTransport(
  req: Request,
  body: unknown
): Promise<{ transport: WebStandardStreamableHTTPServerTransport } | { errorResponse: Response }> {
  const sessionId = req.headers.get("mcp-session-id") ?? undefined;
  const existing = sessionId ? transports[sessionId] : undefined;
  if (existing) return { transport: existing };

  if (sessionId || !isInitializeRequest(body)) {
    return {
      errorResponse: Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: send an initialize request first" }, id: null },
        { status: 400, headers: CORS_HEADERS }
      ),
    };
  }

  let transport: WebStandardStreamableHTTPServerTransport;
  transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sid) => {
      transports[sid] = transport;
    },
  });
  await createServer().connect(transport);
  return { transport };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await getOrCreateTransport(req, body);
  if ("errorResponse" in result) return result.errorResponse;

  const response = await result.transport.handleRequest(req, { parsedBody: body });
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

export async function DELETE(req: Request) {
  const sessionId = req.headers.get("mcp-session-id") ?? undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    return Response.json({ error: "session_not_found" }, { status: 404, headers: CORS_HEADERS });
  }
  await transport.close();
  if (sessionId) delete transports[sessionId];
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, DELETE, OPTIONS" } });
}
