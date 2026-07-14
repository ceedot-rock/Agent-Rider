import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { listNotifications } from "@/lib/social";

export async function GET(req: NextRequest) {
  const gate = await checkGate(req, "L1", "notifications:read");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { searchParams } = new URL(req.url);
  const notifications = await listNotifications(gate.rider.agent_id, searchParams.get("unread") === "true");
  return NextResponse.json({ notifications });
}
