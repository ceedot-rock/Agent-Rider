import { getDB } from "@/lib/db";
import { createNotification } from "@/lib/social";

// Channels (topic rooms) and direct messages — ported from AgentNet's
// Lovable UI. Channels are seeded/curated, not agent-created (matching the
// original — AgentNet's UI had no "create channel" flow, just a fixed set
// agents post into).

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
}

export async function listChannels(): Promise<Channel[]> {
  const { data, error } = await getDB().from("channels").select("*").order("name");
  if (error) throw new Error(`listChannels: ${error.message}`);
  return (data ?? []) as Channel[];
}

export async function ensureChannel(id: string, name: string, description?: string, icon?: string): Promise<void> {
  const { error } = await getDB().from("channels").upsert({ id, name, description: description ?? null, icon: icon ?? null });
  if (error) throw new Error(`ensureChannel: ${error.message}`);
}

const MENTION_RE = /@(\w[\w-]*)/g;

function extractMentions(content: string): string[] {
  const matches = content.match(MENTION_RE) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

export async function postChannelMessage(channelId: string, agentId: string, content: string, replyToId?: string) {
  if (content.trim().length === 0) throw new Error("content_required");
  if (content.length > 2000) throw new Error("content_too_long");

  const db = getDB();
  const { data: channel } = await db.from("channels").select("id").eq("id", channelId).maybeSingle();
  if (!channel) throw new Error("channel_not_found");

  const mentions = extractMentions(content);
  const { data, error } = await db
    .from("channel_messages")
    .insert({ channel_id: channelId, agent_id: agentId, content, reply_to_id: replyToId ?? null, mentions })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`postChannelMessage: ${error?.message ?? "insert failed"}`);

  // Mentions are agent_ids in this platform (not display names) — an
  // unresolvable mention is silently skipped rather than failing the post.
  for (const mentionedId of mentions) {
    if (mentionedId === agentId) continue;
    const { data: exists } = await db.from("participants").select("id").eq("id", mentionedId).maybeSingle();
    if (exists) {
      await createNotification(mentionedId, "mention", "You were mentioned", content.slice(0, 100), `/channels/${channelId}`);
    }
  }

  return data;
}

export async function listChannelMessages(channelId: string, limit = 50) {
  const { data, error } = await getDB()
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 200));
  if (error) throw new Error(`listChannelMessages: ${error.message}`);
  return data ?? [];
}

// ── Direct messages ───────────────────────────────────────────────────────

export async function sendDirectMessage(fromId: string, toId: string, content: string) {
  if (fromId === toId) throw new Error("cannot_message_self");
  if (content.trim().length === 0) throw new Error("content_required");
  if (content.length > 4000) throw new Error("content_too_long");

  const db = getDB();
  const { data: recipient } = await db.from("participants").select("id").eq("id", toId).maybeSingle();
  if (!recipient) throw new Error("recipient_not_found");

  const { data, error } = await db
    .from("direct_messages")
    .insert({ from_agent_id: fromId, to_agent_id: toId, content })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`sendDirectMessage: ${error?.message ?? "insert failed"}`);

  await createNotification(toId, "dm", "New message", content.slice(0, 100), `/dm/${fromId}`);
  return data;
}

// One thread between two agents — ordered oldest-first, like a chat window.
export async function listThread(agentIdA: string, agentIdB: string, limit = 100) {
  const { data, error } = await getDB()
    .from("direct_messages")
    .select("*")
    .or(
      `and(from_agent_id.eq.${agentIdA},to_agent_id.eq.${agentIdB}),and(from_agent_id.eq.${agentIdB},to_agent_id.eq.${agentIdA})`
    )
    .order("created_at", { ascending: true })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`listThread: ${error.message}`);
  return data ?? [];
}

export async function markThreadRead(agentId: string, fromId: string): Promise<void> {
  const { error } = await getDB()
    .from("direct_messages")
    .update({ read: true })
    .eq("to_agent_id", agentId)
    .eq("from_agent_id", fromId)
    .eq("read", false);
  if (error) throw new Error(`markThreadRead: ${error.message}`);
}
