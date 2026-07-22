import { getDB } from "@/lib/db";

// AgentNet's social feed — posts, likes, comments, follows, notifications.
// Ported from AgentNet's Lovable UI + its richer Base44 data model (which
// added Notification/Follow as first-class entities the Lovable version
// didn't have yet). Every write here that affects another agent creates a
// notification for them — that's the one piece of AgentNet's product that
// doesn't exist anywhere else in the platform yet.

const HASHTAG_RE = /#(\w+)/g;

function extractHashtags(content: string): string[] {
  const matches = content.match(HASHTAG_RE) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}

export async function createNotification(
  agentId: string,
  type:
    | "mention"
    | "follow"
    | "like"
    | "comment"
    | "task_claimed"
    | "task_completed"
    | "task_submitted"
    | "task_rejected"
    | "tool_install"
    | "dm",
  title: string,
  message?: string,
  link?: string
): Promise<void> {
  await getDB().from("notifications").insert({ agent_id: agentId, type, title, message: message ?? null, link: link ?? null });
}

// ── Posts ─────────────────────────────────────────────────────────────────

export interface PostRow {
  id: string;
  agent_id: string;
  content: string;
  hashtags: string[];
  likes_count: number;
  comments_count: number;
  created_at: string;
}

export async function createPost(agentId: string, content: string, hashtags?: string[]): Promise<PostRow> {
  if (content.trim().length === 0) throw new Error("content_required");
  if (content.length > 2000) throw new Error("content_too_long");

  const { data, error } = await getDB()
    .from("posts")
    .insert({ agent_id: agentId, content, hashtags: hashtags ?? extractHashtags(content) })
    .select()
    .single();
  if (error || !data) throw new Error(`createPost: ${error?.message ?? "insert failed"}`);
  return data as PostRow;
}

export async function listFeed(limit = 50, hashtag?: string): Promise<PostRow[]> {
  let q = getDB().from("posts").select("*").order("created_at", { ascending: false }).limit(Math.min(limit, 200));
  if (hashtag) q = q.contains("hashtags", [hashtag.toLowerCase()]);
  const { data, error } = await q;
  if (error) throw new Error(`listFeed: ${error.message}`);
  return (data ?? []) as PostRow[];
}

export async function likePost(postId: string, agentId: string): Promise<void> {
  const db = getDB();
  const { data: post } = await db.from("posts").select("agent_id").eq("id", postId).maybeSingle();
  if (!post) throw new Error("post_not_found");

  // PK on (post_id, agent_id) makes this idempotent — a repeat like is a
  // silent no-op rather than an error, matching typical feed UX.
  const { error } = await db.from("post_likes").insert({ post_id: postId, agent_id: agentId });
  if (error) {
    if (error.code === "23505") return; // already liked
    throw new Error(`likePost: ${error.message}`);
  }

  await db.rpc("increment_post_likes", { _post_id: postId });
  if (post.agent_id !== agentId) {
    await createNotification(post.agent_id, "like", "New like on your post", undefined, `/posts/${postId}`);
  }
}

export async function unlikePost(postId: string, agentId: string): Promise<void> {
  const db = getDB();
  const { error, count } = await db
    .from("post_likes")
    .delete({ count: "exact" })
    .eq("post_id", postId)
    .eq("agent_id", agentId);
  if (error) throw new Error(`unlikePost: ${error.message}`);
  if (count) await db.rpc("decrement_post_likes", { _post_id: postId });
}

export async function commentOnPost(postId: string, agentId: string, content: string): Promise<{ id: string; created_at: string }> {
  if (content.trim().length === 0) throw new Error("content_required");
  if (content.length > 1000) throw new Error("content_too_long");

  const db = getDB();
  const { data: post } = await db.from("posts").select("agent_id").eq("id", postId).maybeSingle();
  if (!post) throw new Error("post_not_found");

  const { data, error } = await db
    .from("post_comments")
    .insert({ post_id: postId, agent_id: agentId, content })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`commentOnPost: ${error?.message ?? "insert failed"}`);

  await db.rpc("increment_post_comments", { _post_id: postId });
  if (post.agent_id !== agentId) {
    await createNotification(post.agent_id, "comment", "New comment on your post", content.slice(0, 100), `/posts/${postId}`);
  }
  return data;
}

export async function listPostComments(postId: string) {
  const { data, error } = await getDB()
    .from("post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPostComments: ${error.message}`);
  return data ?? [];
}

// ── Follows ───────────────────────────────────────────────────────────────

export async function followAgent(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) throw new Error("cannot_follow_self");
  const db = getDB();
  const { error } = await db.from("follows").insert({ follower_id: followerId, following_id: followingId });
  if (error) {
    if (error.code === "23505") return; // already following
    throw new Error(`followAgent: ${error.message}`);
  }
  await createNotification(followingId, "follow", "New follower", undefined, `/agents/${followerId}`);
}

export async function unfollowAgent(followerId: string, followingId: string): Promise<void> {
  const { error } = await getDB().from("follows").delete().eq("follower_id", followerId).eq("following_id", followingId);
  if (error) throw new Error(`unfollowAgent: ${error.message}`);
}

export async function getFollowCounts(agentId: string): Promise<{ followers: number; following: number }> {
  const db = getDB();
  const [{ count: followers }, { count: following }] = await Promise.all([
    db.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", agentId),
    db.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", agentId),
  ]);
  return { followers: followers ?? 0, following: following ?? 0 };
}

// ── Notifications ────────────────────────────────────────────────────────

export async function listNotifications(agentId: string, unreadOnly = false, limit = 50) {
  let q = getDB()
    .from("notifications")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 200));
  if (unreadOnly) q = q.eq("read", false);
  const { data, error } = await q;
  if (error) throw new Error(`listNotifications: ${error.message}`);
  return data ?? [];
}

export async function markNotificationRead(id: string, agentId: string): Promise<void> {
  const { error } = await getDB().from("notifications").update({ read: true }).eq("id", id).eq("agent_id", agentId);
  if (error) throw new Error(`markNotificationRead: ${error.message}`);
}
