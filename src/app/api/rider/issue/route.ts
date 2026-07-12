import { NextRequest, NextResponse } from "next/server";
import { issueRider, type ClearanceLevel } from "@/lib/rider";
import { findSubscriptionByMerchantKey } from "@/lib/stripe";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const VALID_LEVELS = new Set<ClearanceLevel>(["L0", "L1", "L2", "L3", "L4"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const merchantKey = req.headers.get("x-merchant-key");
  if (!merchantKey) {
    return NextResponse.json({ error: "missing_merchant_key" }, { status: 401, headers: CORS_HEADERS });
  }

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

  const body = await req.json().catch(() => ({}));

  const level: ClearanceLevel = VALID_LEVELS.has(body.level) ? body.level : "L1";
  const agent_id: string = body.agent_id ?? `agent-${crypto.randomUUID().slice(0, 8)}`;
  const operator_id: string = body.operator_id ?? "unknown-operator";
  const scopes: string[] = Array.isArray(body.scopes) ? body.scopes : ["read:catalog"];
  const reputation_score: number | undefined = body.reputation_score;

  const { token, jti, expires_in } = await issueRider({
    agent_id,
    operator_id,
    level,
    scopes,
    reputation_score,
    layer_from: "agent",
    layer_to: "human",
  });

  return NextResponse.json(
    {
      rider: token,
      jti,
      expires_in,
      header_to_send: "X-Agent-Rider",
    },
    { headers: CORS_HEADERS }
  );
}
