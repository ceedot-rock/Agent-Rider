import { NextRequest, NextResponse } from "next/server";
import {
  cookieBase,
  GATE_COOKIE,
  gateCookieValue,
  gatePasswordSet,
  isSecureRequest,
  verifyPassword,
} from "@/lib/chat-gate";

export async function POST(req: NextRequest) {
  if (!gatePasswordSet()) {
    return NextResponse.json({ error: "gate_not_configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !verifyPassword(password)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, unlocked: true });
  res.cookies.set(GATE_COOKIE, gateCookieValue(), cookieBase(isSecureRequest(req)));
  return res;
}
