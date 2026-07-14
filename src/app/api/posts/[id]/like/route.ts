import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { likePost, unlikePost } from "@/lib/social";

const ERROR_STATUS: Record<string, number> = { post_not_found: 404 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "posts:like");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  try {
    await likePost(id, gate.rider.agent_id);
    return NextResponse.json({ ok: true, postId: id });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "posts:like");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  await unlikePost(id, gate.rider.agent_id);
  return NextResponse.json({ ok: true, postId: id });
}
