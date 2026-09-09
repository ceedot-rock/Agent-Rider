import { NextRequest, NextResponse } from "next/server";
import { registerParticipant, type ParticipantType } from "@/lib/agents";

const VALID_TYPES = new Set<ParticipantType>(["agent", "human"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "missing_name" }, { status: 400 });
    }
    const type: ParticipantType = VALID_TYPES.has(body.type) ? body.type : "agent";

    const { participant, apiKey, store, dbError } = await registerParticipant({
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
        store,
        db_error: dbError ?? null,
        note:
          store === "disk"
            ? "Stored on this Fly instance only — Supabase INSERT failed. Run the service_role GRANT. Store api_key now."
            : "Store api_key now — it is never shown again.",
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "register_failed";
    return NextResponse.json({ error: "register_failed", detail: msg.slice(0, 240) }, { status: 500 });
  }
}
