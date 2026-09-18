import { NextResponse } from "next/server";
import { hostApiKeyConfigured, isChatUnlocked } from "@/lib/chat-gate";

/** After unlock: whether Fly/server has HOST_CHAT_API_KEY (never returns the key). */
export async function GET() {
  if (!(await isChatUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  return NextResponse.json({ has_server_key: hostApiKeyConfigured() });
}
