import { NextRequest, NextResponse } from "next/server";
import {
  API_KEY_COOKIE,
  cookieBase,
  hostApiKeyFromEnv,
  isGateUnlocked,
  isSecureRequest,
} from "@/lib/chat-gate";

/** Store host API key in httpOnly cookie when HOST_CHAT_API_KEY is unset. */
export async function POST(req: NextRequest) {
  if (!(await isGateUnlocked())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (hostApiKeyFromEnv()) {
    return NextResponse.json({ error: "env_key_configured", ok: true, hasHostKey: true });
  }

  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  if (!apiKey) {
    return NextResponse.json({ error: "missing_api_key" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, hasHostKey: true });
  res.cookies.set(API_KEY_COOKIE, apiKey, cookieBase(isSecureRequest(req)));
  return res;
}
