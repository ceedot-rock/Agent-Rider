import { NextResponse } from "next/server";
import { hostApiKeyConfigured, isChatUnlocked } from "@/lib/chat-gate";
import { getHostChatRoster, getHostChatRooms } from "@/lib/host-chat-roster";
import { ensureLabTeamChannel } from "@/lib/channels";

/** After unlock: server-key flag + team roster/rooms (ids/names only — never keys). */
export async function GET() {
  if (!(await isChatUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  try {
    await ensureLabTeamChannel();
  } catch (err) {
    console.error("host-chat-config: ensureLabTeamChannel failed", (err as Error).message);
  }

  return NextResponse.json({
    has_server_key: hostApiKeyConfigured(),
    seats: getHostChatRoster(),
    rooms: getHostChatRooms(),
  });
}
