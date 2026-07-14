import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { commentOnPost, listPostComments } from "@/lib/social";

const ERROR_STATUS: Record<string, number> = { post_not_found: 404 };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comments = await listPostComments(id);
  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "posts:comment");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }
  try {
    const comment = await commentOnPost(id, gate.rider.agent_id, body.content);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
