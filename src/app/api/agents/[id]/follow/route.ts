import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { followAgent, unfollowAgent, getFollowCounts } from "@/lib/social";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await getFollowCounts(id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "follows:write");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  try {
    await followAgent(gate.rider.agent_id, id);
    return NextResponse.json({ ok: true, following: id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "follows:write");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  await unfollowAgent(gate.rider.agent_id, id);
  return NextResponse.json({ ok: true, unfollowed: id });
}
