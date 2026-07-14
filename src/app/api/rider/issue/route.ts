import { NextRequest, NextResponse } from "next/server";
import { issueRider, type ClearanceLevel } from "@/lib/rider";
import { findSubscriptionByMerchantKey } from "@/lib/stripe";
import { resolveById, resolveByApiKey } from "@/lib/agents";
import { getBlendedTrustScore } from "@/lib/reputation";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const VALID_LEVELS = new Set<ClearanceLevel>(["L0", "L1", "L2", "L3", "L4"]);
const SELF_SERVICE_MAX_LEVEL: ClearanceLevel = "L1";
const LEVEL_RANK: Record<ClearanceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Merchant-Key, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

// Two ways to mint a rider, previously only one existed:
//
// 1. Merchant-gated (original): a paying merchant (X-Merchant-Key, active
//    Stripe subscription) mints a token for *any* agent_id at *any* level —
//    the original Merchant Gate "verification as a service" product.
// 2. Self-service (new): a registered participant mints a token for
//    *themselves*, proven by their own api_key from POST /api/agents.
//    Capped at L1 regardless of what's requested — higher clearance stays
//    merchant- or platform-granted, not self-assigned. Without this path,
//    a freshly registered agent had no way to obtain a rider_token at all,
//    which every write tool on the platform (tasks, credits, claims,
//    comms — everything from the agentmagnet/AgentNet/AgenticLive ports)
//    requires. Merchant Gate was designed for a different product shape
//    (merchants verifying agents before serving them) and never had a path
//    for agents to act as first-class participants on their own.
export async function POST(req: NextRequest) {
  const merchantKey = req.headers.get("x-merchant-key");
  const apiKey = extractBearer(req);

  if (!merchantKey && !apiKey) {
    return NextResponse.json(
      {
        error: "missing_auth",
        hint: "send X-Merchant-Key (paid merchant, any agent/level) or Authorization: Bearer <your api_key> (self-service, capped at L1)",
      },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const body = await req.json().catch(() => ({}));
  const requestedLevel: ClearanceLevel = VALID_LEVELS.has(body.level) ? body.level : "L1";
  const scopes: string[] = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ["*"];

  if (merchantKey) {
    try {
      const subscription = await findSubscriptionByMerchantKey(merchantKey);
      if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) {
        return NextResponse.json(
          { error: "invalid_or_inactive_merchant_key" },
          { status: 402, headers: CORS_HEADERS }
        );
      }
    } catch (err: any) {
      console.error("rider issue: merchant key check failed", err);
      return NextResponse.json(
        { error: "merchant_key_check_failed" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const agent_id: string = body.agent_id ?? `agent-${crypto.randomUUID().slice(0, 8)}`;
    const operator_id: string = body.operator_id ?? "unknown-operator";

    // Look up the real computed trust score for registered agents instead of
    // trusting a caller-supplied value. Unregistered agent_ids (common here —
    // merchants can mint for agent_ids that never registered with us) simply
    // carry no reputation_score.
    const participant = await resolveById(agent_id).catch(() => null);
    const reputation_score = participant ? await getBlendedTrustScore(agent_id) : undefined;

    const { token, jti, expires_in } = await issueRider({
      agent_id,
      operator_id,
      level: requestedLevel,
      scopes,
      reputation_score,
      layer_from: "agent",
      layer_to: "human",
    });

    return NextResponse.json(
      { rider: token, jti, expires_in, header_to_send: "X-Agent-Rider" },
      { headers: CORS_HEADERS }
    );
  }

  const participant = await resolveByApiKey(apiKey!);
  if (!participant) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401, headers: CORS_HEADERS });
  }

  const level: ClearanceLevel =
    LEVEL_RANK[requestedLevel] < LEVEL_RANK[SELF_SERVICE_MAX_LEVEL] ? requestedLevel : SELF_SERVICE_MAX_LEVEL;
  const reputation_score = await getBlendedTrustScore(participant.id);

  const { token, jti, expires_in } = await issueRider({
    agent_id: participant.id,
    operator_id: participant.operatorId ?? "self",
    level,
    scopes,
    reputation_score,
    layer_from: participant.type,
    layer_to: "human",
  });

  return NextResponse.json(
    { rider: token, jti, expires_in, header_to_send: "X-Agent-Rider" },
    { headers: CORS_HEADERS }
  );
}
