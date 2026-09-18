import { NextRequest, NextResponse } from "next/server";
import { isGateUnlocked, resolveHostApiKey } from "@/lib/chat-gate";
import { resolveByApiKey } from "@/lib/agents";
import { getBlendedTrustScore } from "@/lib/reputation";
import { issueRider, type ClearanceLevel } from "@/lib/rider";

const VALID_LEVELS = new Set<ClearanceLevel>(["L0", "L1", "L2", "L3", "L4"]);
const SELF_SERVICE_MAX: ClearanceLevel = "L1";
const LEVEL_RANK: Record<ClearanceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

/**
 * Thin BFF: mints a host rider the same way POST /api/rider/issue does for
 * self-service (Bearer api_key, capped at L1). Uses HOST_CHAT_API_KEY or the
 * httpOnly pasted key — never returns the key to the client.
 */
export async function POST(req: NextRequest) {
  if (!(await isGateUnlocked())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = await resolveHostApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "missing_host_api_key", needsApiKey: true }, { status: 400 });
  }

  const participant = await resolveByApiKey(apiKey);
  if (!participant) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requested: ClearanceLevel = VALID_LEVELS.has(body.level) ? body.level : "L1";
  const level: ClearanceLevel =
    LEVEL_RANK[requested] < LEVEL_RANK[SELF_SERVICE_MAX] ? requested : SELF_SERVICE_MAX;
  const scopes =
    Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ["dm:read", "dm:send", "*"];

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

  return NextResponse.json({
    rider: token,
    jti,
    expires_in,
    header_to_send: "X-Agent-Rider",
  });
}
