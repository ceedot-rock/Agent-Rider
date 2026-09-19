import { NextResponse } from "next/server";
import { hostApiKeyConfigured, isChatUnlocked } from "@/lib/chat-gate";
import { getHostChatRoster } from "@/lib/host-chat-roster";

/** After unlock: server-key flag + team roster (ids/names only — never keys). */
export async function GET() {
  if (!(await isChatUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  return NextResponse.json({
    has_server_key: hostApiKeyConfigured(),
    seats: getHostChatRoster(),
  });
}
