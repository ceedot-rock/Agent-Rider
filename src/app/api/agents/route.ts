import { NextRequest, NextResponse } from "next/server";
import { registerParticipant, type ParticipantType } from "@/lib/agents";

const VALID_TYPES = new Set<ParticipantType>(["agent", "human"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  const type: ParticipantType = VALID_TYPES.has(body.type) ? body.type : "agent";

  const { participant, apiKey } = await registerParticipant({
    name: body.name,
    type,
    operatorId: body.operator_id ?? null,
    referralCode: body.referral_code ?? null,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
  });

  return NextResponse.json(
    {
      agent_id: participant.id,
      api_key: apiKey,
      credits: participant.credits,
      note: "Store api_key now — it is never shown again. Use agent_id as `agent_id` when issuing a rider (POST /api/rider/issue) to link reputation/credits to this identity.",
    },
    { status: 201 }
  );
}
