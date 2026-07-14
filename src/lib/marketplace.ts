import { getDB } from "@/lib/db";
import { createNotification } from "@/lib/social";

// Tool marketplace — agents publish tools other agents can discover and
// install, ported from Base44 AgentNet's Tool entity (richer than the
// Lovable version, which didn't have this at all).

export const TOOL_CATEGORIES = [
  "Data Processing", "Web Scraping", "Code Generation", "Image Analysis",
  "NLP", "Database", "API Integration", "Security",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface MarketplaceToolRow {
  id: string;
  name: string;
  description: string;
  category: string;
  author_agent_id: string;
  endpoint_url: string | null;
  version: string;
  installs: number;
  rating_sum: number;
  rating_count: number;
  tags: string[];
  created_at: string;
}

export interface PublishToolInput {
  authorAgentId: string;
  name: string;
  description: string;
  category: ToolCategory;
  endpointUrl?: string;
  version?: string;
  tags?: string[];
}

export async function publishTool(input: PublishToolInput): Promise<MarketplaceToolRow> {
  if (input.name.trim().length === 0) throw new Error("name_required");
  if (input.description.trim().length === 0) throw new Error("description_required");

  const { data, error } = await getDB()
    .from("marketplace_tools")
    .insert({
      name: input.name.slice(0, 100),
      description: input.description.slice(0, 1000),
      category: input.category,
      author_agent_id: input.authorAgentId,
      endpoint_url: input.endpointUrl ?? null,
      version: input.version ?? "1.0.0",
      tags: input.tags ?? [],
    })
    .select()
    .single();
  if (error || !data) throw new Error(`publishTool: ${error?.message ?? "insert failed"}`);
  return data as MarketplaceToolRow;
}

export interface ListToolsInput {
  category?: ToolCategory;
  limit?: number;
  sort?: "installs" | "recent";
}

export async function listTools(input: ListToolsInput = {}) {
  let q = getDB().from("marketplace_tools").select("*").limit(Math.min(input.limit ?? 50, 200));
  q = input.sort === "recent" ? q.order("created_at", { ascending: false }) : q.order("installs", { ascending: false });
  if (input.category) q = q.eq("category", input.category);
  const { data, error } = await q;
  if (error) throw new Error(`listTools: ${error.message}`);
  return (data ?? []).map(withAverageRating);
}

export async function getTool(toolId: string) {
  const { data, error } = await getDB().from("marketplace_tools").select("*").eq("id", toolId).maybeSingle();
  if (error) throw new Error(`getTool: ${error.message}`);
  if (!data) return null;
  return withAverageRating(data as MarketplaceToolRow);
}

function withAverageRating(row: MarketplaceToolRow) {
  return { ...row, rating: row.rating_count > 0 ? +(row.rating_sum / row.rating_count).toFixed(2) : null };
}

// Installing twice just updates your rating (upsert on the (tool_id,
// agent_id) PK) rather than erroring — an agent revising its opinion of a
// tool it already has is a normal flow, not a conflict.
export async function installTool(toolId: string, agentId: string, rating?: number): Promise<void> {
  if (rating !== undefined && (rating < 1 || rating > 5)) throw new Error("invalid_rating");

  const db = getDB();
  const { data: tool } = await db.from("marketplace_tools").select("author_agent_id, rating_sum, rating_count").eq("id", toolId).maybeSingle();
  if (!tool) throw new Error("tool_not_found");

  const { data: existing } = await db
    .from("tool_installs")
    .select("rating")
    .eq("tool_id", toolId)
    .eq("agent_id", agentId)
    .maybeSingle();

  const { error } = await db
    .from("tool_installs")
    .upsert({ tool_id: toolId, agent_id: agentId, rating: rating ?? existing?.rating ?? null });
  if (error) throw new Error(`installTool: ${error.message}`);

  if (!existing) {
    await db.rpc("increment_tool_installs", { _tool_id: toolId });
    if (tool.author_agent_id !== agentId) {
      await createNotification(tool.author_agent_id, "tool_install", "Someone installed your tool", undefined, `/tools/${toolId}`);
    }
  }

  if (rating !== undefined && rating !== existing?.rating) {
    const delta = existing?.rating ? rating - existing.rating : rating;
    const ratingCountDelta = existing?.rating ? 0 : 1;
    await db
      .from("marketplace_tools")
      .update({ rating_sum: tool.rating_sum + delta, rating_count: tool.rating_count + ratingCountDelta })
      .eq("id", toolId);
  }
}
