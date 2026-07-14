import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { installTool, getTool } from "@/lib/marketplace";

const ERROR_STATUS: Record<string, number> = { tool_not_found: 404, invalid_rating: 400 };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tool = await getTool(id);
  if (!tool) return NextResponse.json({ error: "tool_not_found" }, { status: 404 });
  return NextResponse.json({ tool });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await checkGate(req, "L1", "tools:install");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    await installTool(id, gate.rider.agent_id, body.rating);
    return NextResponse.json({ ok: true, toolId: id });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: ERROR_STATUS[message] ?? 400 });
  }
}
