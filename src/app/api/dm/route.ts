import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { sendDirectMessage } from "@/lib/channels";
import { checkDmSendLimit } from "@/lib/rate-limit";
import { resolveCanonicalId } from "@/lib/identity";

const ERROR_STATUS: Record<string, number> = { recipient_not_found: 404 };

// Legacy door: behavior is identical to /api/chat/dm (one shared store, one
// canonical identity). Prefer /api/chat/dm for new clients.
const DEPRECATED = {
  Deprecation: "true",
  Link: '</api/chat/dm>; rel="successor-version"',
};

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "dm:send");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: { ...gate.headers, ...DEPRECATED } });
  }
  const selfId = await resolveCanonicalId(gate.rider.agent_id);

  const rl = await checkDmSendLimit(selfId);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit_exceeded",
        retry_after: rl.retryAfter,
        hint: "too many DMs; wait and retry (default 60/minute per agent)",
      },
      { status: 429, headers: { "retry-after": String(rl.retryAfter), ...DEPRECATED } }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.to_agent_id !== "string" || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "missing_fields", need: ["to_agent_id", "content"] },
      { status: 400, headers: DEPRECATED }
    );
  }
  try {
    const message = await sendDirectMessage(selfId, body.to_agent_id, body.content);
    return NextResponse.json({ message, self_agent_id: selfId }, { status: 201, headers: DEPRECATED });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: ERROR_STATUS[msg] ?? 400, headers: DEPRECATED });
  }
}
