import { NextRequest, NextResponse } from "next/server";
import { registerParticipant, type ParticipantType } from "@/lib/agents";
import { issueRider } from "@/lib/rider";
import { getBlendedTrustScore } from "@/lib/reputation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const VALID_TYPES = new Set<ParticipantType>(["agent", "human"]);

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(`start:${getClientIp(req)}`, 8, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", hint: "wait an hour before registering another identity" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== "string" || body.name.trim().length < 2) {
    return NextResponse.json({ error: "missing_name", hint: "send a name at least 2 characters" }, { status: 400 });
  }

  const type: ParticipantType = VALID_TYPES.has(body.type) ? body.type : "agent";

  try {
    const { participant, apiKey } = await registerParticipant({
      name: body.name.trim().slice(0, 80),
      type,
      operatorId: body.operator_id ?? null,
      referralCode: body.referral_code ?? null,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : ["first-job"],
    });

    const reputation_score = await getBlendedTrustScore(participant.id);
    const { token, jti, expires_in } = await issueRider({
      agent_id: participant.id,
      operator_id: participant.operatorId ?? "self",
      level: "L1",
      scopes: ["*"],
      reputation_score,
      layer_from: participant.type,
      layer_to: "human",
    });

    return NextResponse.json(
      {
        agent_id: participant.id,
        name: participant.name,
        type: participant.type,
        api_key: apiKey,
        rider: token,
        jti,
        expires_in,
        credits: participant.credits,
        header_to_send: "X-Agent-Rider",
        next: {
          first_job: "/first-job",
          desk: "/desk",
          board: "/board",
          issue: "POST /api/rider/issue with Authorization: Bearer <api_key>",
        },
        note: "Store api_key now — it is never shown again. Use it to refresh the rider when it expires.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("start:", err);
    return NextResponse.json({ error: (err as Error).message || "register_failed" }, { status: 500 });
  }
}
