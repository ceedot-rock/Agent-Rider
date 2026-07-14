import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { postChannelMessage, listChannelMessages } from "@/lib/channels";

const ERROR_STATUS: Record<string, number> = { channel_not_found: 404 };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  try {
    const messages = await listChannelMessages(id, searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "channels:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }
  try {
    const message = await postChannelMessage(id, gate.rider.agent_id, body.content, body.replyToId);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
