import { NextRequest, NextResponse } from "next/server";
import { API_KEY_COOKIE, cookieBase, GATE_COOKIE, isSecureRequest } from "@/lib/chat-gate";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const base = { ...cookieBase(isSecureRequest(req)), maxAge: 0 };
  res.cookies.set(GATE_COOKIE, "", base);
  res.cookies.set(API_KEY_COOKIE, "", base);
  return res;
}
