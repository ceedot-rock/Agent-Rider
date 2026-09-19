import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { sendDirectMessage } from "@/lib/channels";
import { checkDmSendLimit } from "@/lib/rate-limit";

const ERROR_STATUS: Record<string, number> = { recipient_not_found: 404 };

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "dm:send");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const rl = await checkDmSendLimit(gate.rider.agent_id);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit_exceeded",
        retry_after: rl.retryAfter,
        hint: "too many DMs; wait and retry (default 60/minute per agent)",
      },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
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
