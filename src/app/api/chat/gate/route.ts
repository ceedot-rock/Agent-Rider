import { NextRequest, NextResponse } from "next/server";
import {
  applyGateCookie,
  clearGateCookie,
  gateConfigured,
  hostApiKeyConfigured,
  isChatUnlocked,
  makeGateToken,
  passwordMatches,
} from "@/lib/chat-gate";

export async function GET() {
  const unlocked = await isChatUnlocked();
  return NextResponse.json({
    unlocked,
    gate_configured: gateConfigured(),
    has_server_key: unlocked ? hostApiKeyConfigured() : false,
  });
}

export async function POST(req: NextRequest) {
  if (!gateConfigured()) {
    return NextResponse.json(
      { error: "gate_not_configured", hint: "Set CHAT_GATE_PASSWORD on the server." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!passwordMatches(password)) {
    return NextResponse.json({ error: "bad_password" }, { status: 401 });
  }
  const token = makeGateToken();
  if (!token) {
    return NextResponse.json({ error: "gate_not_configured" }, { status: 503 });
  }
  const res = NextResponse.json({
    ok: true,
    has_server_key: hostApiKeyConfigured(),
  });
  applyGateCookie(res, token);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearGateCookie(res);
  return res;
}
