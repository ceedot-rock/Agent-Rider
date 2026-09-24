import { NextRequest, NextResponse } from "next/server";
import { getHostApiKey, isChatUnlocked } from "@/lib/chat-gate";
import { resolveByApiKey } from "@/lib/agents";
import {
  ensureLabTeamChannel,
  LAB_TEAM_CHANNEL_ID,
  listChannelMessages,
  postChannelMessage,
} from "@/lib/channels";

const ERROR_STATUS: Record<string, number> = { channel_not_found: 404 };

function normalizeMessages(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    id: row.id,
    from_agent_id: row.agent_id ?? row.from_agent_id,
    content: row.content,
    created_at: row.created_at,
    channel_id: row.channel_id,
    reply_to_id: row.reply_to_id,
    mentions: row.mentions,
  }));
}

async function requireHost() {
  if (!(await isChatUnlocked())) {
    return { error: NextResponse.json({ error: "locked" }, { status: 401 }) };
  }
  const apiKey = getHostApiKey();
  if (!apiKey) {
    return {
      error: NextResponse.json(
        {
          error: "no_server_key",
          hint: "HOST_CHAT_API_KEY is unset. Paste a key in the chat UI for this browser session.",
        },
        { status: 503 }
      ),
    };
  }
  const host = await resolveByApiKey(apiKey);
  if (!host) {
    return { error: NextResponse.json({ error: "invalid_host_key" }, { status: 401 }) };
  }
  return { host };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireHost();
  if ("error" in gate && gate.error) return gate.error;
  const { id } = await params;

  if (id === LAB_TEAM_CHANNEL_ID) {
    try {
      await ensureLabTeamChannel();
    } catch (err) {
      console.error("host-chat-channel: ensure failed", (err as Error).message);
    }
  }

  const { searchParams } = new URL(req.url);
  try {
    const rows = await listChannelMessages(
      id,
      searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined
    );
    // Channel list returns newest-first; Host Chat UI expects oldest-first like DMs.
    const chronological = [...rows].reverse();
    return NextResponse.json({
      messages: normalizeMessages(chronological as Array<Record<string, unknown>>),
      self_agent_id: gate.host!.id,
      room_id: id,
      kind: "channel",
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: ERROR_STATUS[msg] ?? 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireHost();
  if ("error" in gate && gate.error) return gate.error;
  const { id } = await params;

  if (id === LAB_TEAM_CHANNEL_ID) {
    try {
      await ensureLabTeamChannel();
    } catch (err) {
      console.error("host-chat-channel: ensure failed", (err as Error).message);
    }
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }
  try {
    const message = await postChannelMessage(id, gate.host!.id, body.content, body.replyToId);
    return NextResponse.json(
      {
        message: {
          id: message.id,
          from_agent_id: (message as { agent_id?: string }).agent_id,
          content: message.content,
          created_at: message.created_at,
          channel_id: (message as { channel_id?: string }).channel_id,
        },
        self_agent_id: gate.host!.id,
        room_id: id,
        kind: "channel",
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: ERROR_STATUS[msg] ?? 400 });
  }
}
