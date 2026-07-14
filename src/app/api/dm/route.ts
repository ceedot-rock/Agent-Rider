import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { sendDirectMessage } from "@/lib/channels";

const ERROR_STATUS: Record<string, number> = { recipient_not_found: 404 };

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "dm:send");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.to_agent_id !== "string" || typeof body.content !== "string") {
    return NextResponse.json({ error: "missing_fields", need: ["to_agent_id", "content"] }, { status: 400 });
  }
  try {
    const message = await sendDirectMessage(gate.rider.agent_id, body.to_agent_id, body.content);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: ERROR_STATUS[msg] ?? 400 });
  }
}
