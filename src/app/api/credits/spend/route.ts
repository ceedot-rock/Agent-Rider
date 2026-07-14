import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { spendCredits, SERVICE_COSTS } from "@/lib/credits";

const ERROR_STATUS: Record<string, number> = {
  unknown_service: 400,
  participant_not_found: 404,
  insufficient_credits: 402,
  prompt_required: 400,
};

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "credits:spend");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.service !== "string") {
    return NextResponse.json({ error: "service_required", available_services: SERVICE_COSTS }, { status: 400 });
  }

  try {
    const result = await spendCredits(gate.rider.agent_id, body.service, body.units ?? 1, body.prompt);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    const known = message.split(":")[0];
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[known] ?? 400 });
  }
}
