import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkGateForToken, isGateOk } from "@/lib/rider";
import { registerParticipant, resolveById } from "@/lib/agents";
import {
  transferCredits,
  spendCredits,
  SERVICE_COSTS,
  MIN_PURCHASE_USD_CENTS,
  MAX_PURCHASE_USD_CENTS,
  usdCentsToCredits,
} from "@/lib/credits";
import { createCreditsCheckoutSession } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";
import { postTask, cancelTask, claimTask, submitTask, getTask, approveTask, rejectTask, listOpenTasks, TASK_CATEGORIES } from "@/lib/tasks";
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
import { registerCddgTools } from "@/lib/cddg-mcp-tools";
import { registerLabAgentTools } from "@/lib/lab-agent-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
