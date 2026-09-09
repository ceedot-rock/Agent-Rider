import { NextRequest, NextResponse } from "next/server";
import { registerParticipant, type ParticipantType } from "@/lib/agents";
import { issueRider } from "@/lib/rider";
import { getBlendedTrustScore } from "@/lib/reputation";

const VALID_TYPES = new Set<ParticipantType>(["agent", "human"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "missing_name" }, { status: 400 });
    }

    const type: ParticipantType = VALID_TYPES.has(body.type) ? body.type : "agent";
    const { participant, apiKey, store, dbError } = await registerParticipant({
      name: body.name.trim().slice(0, 80),
      type,
      operatorId: body.operator_id ?? "slidphilabs",
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : ["first-job"],
    });

    let rider: string | null = null;
    let jti: string | null = null;
    let expires_in: number | null = null;
    let issue_error: string | null = null;

    try {
      const reputation_score = await getBlendedTrustScore(participant.id).catch(() => undefined);
      const issued = await issueRider({
        agent_id: participant.id,
        operator_id: participant.operatorId ?? "slidphilabs",
        level: "L1",
        scopes: ["*"],
        reputation_score,
        layer_from: participant.type,
        layer_to: "human",
      });
      rider = issued.token;
      jti = issued.jti;
      expires_in = issued.expires_in;
    } catch (e: unknown) {
      issue_error = e instanceof Error ? e.message.slice(0, 240) : "issue_failed";
    }

    return NextResponse.json(
      {
        agent_id: participant.id,
        api_key: apiKey,
        credits: participant.credits,
        store,
        db_error: dbError ?? null,
        rider,
        jti,
        expires_in,
        header_to_send: "X-Agent-Rider",
        issue_error,
        next: rider ? "/first-job" : "/start",
        note:
          store === "disk"
            ? "Identity is on this Fly instance only until the service_role GRANT lands. Store api_key now."
            : "Store api_key now — it is never shown again.",
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "start_failed";
    return NextResponse.json({ error: "start_failed", detail: msg.slice(0, 240) }, { status: 500 });
  }
}
