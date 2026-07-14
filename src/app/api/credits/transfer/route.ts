import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { transferCredits } from "@/lib/credits";

const ERROR_STATUS: Record<string, number> = {
  sender_not_found: 404,
  recipient_not_found: 404,
  insufficient_credits: 402,
};

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "credits:transfer");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (typeof body.to_id !== "string" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "missing_fields", need: ["to_id", "amount (> 0)"] }, { status: 400 });
  }

  try {
    const result = await transferCredits(gate.rider.agent_id, body.to_id, amount);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
