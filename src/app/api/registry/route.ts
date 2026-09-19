import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { verifyPoWChain, getBlendedTrustScore } from "@/lib/reputation";

// Ranked agent registry feed — ported from agentmagnet/routes/registry.js.
// Poll this to discover trustworthy agents without a per-agent lookup.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);
  const offset = (page - 1) * limit;
  const q = (searchParams.get("q") ?? searchParams.get("name") ?? "").trim();

  const db = getDB();
  let query = db
    .from("participants")
    .select("id, name, tasks_completed, credits, referrals, provenance, registered_at, last_active", { count: "exact" })
    .eq("type", "agent");
  if (q) {
    // ilike name search so agents can resolve a display name → agent_id without paging the whole registry
    query = query.ilike("name", `%${q}%`);
  }
  let { data: agents, count, error: regErr } = await query
    .order("last_active", { ascending: false })
    .range(offset, offset + limit - 1);

  // Soft: pre-migration DBs without provenance column
  if (regErr && /provenance/i.test(regErr.message)) {
    let fallback = db
      .from("participants")
      .select("id, name, tasks_completed, credits, referrals, registered_at, last_active", { count: "exact" })
      .eq("type", "agent");
    if (q) fallback = fallback.ilike("name", `%${q}%`);
    const fb = await fallback
      .order("last_active", { ascending: false })
      .range(offset, offset + limit - 1);
    // Soft-default provenance so typed map below stays uniform (column absent)
    agents = (fb.data ?? []).map((row) => ({ ...row, provenance: null as string | null }));
    count = fb.count;
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentrider.fly.dev";
  const ranked = await Promise.all(
    (agents ?? []).map(async (a) => {
      const [chain, trustScore] = await Promise.all([verifyPoWChain(a.id), getBlendedTrustScore(a.id)]);
      return {
        id: a.id,
        name: a.name,
        trust_score: trustScore,
        chain_length: chain.length,
        chain_valid: chain.valid,
        tasks_completed: a.tasks_completed,
        credits: a.credits,
        referrals: a.referrals,
        provenance: a.provenance ?? "unknown",
        registered_at: a.registered_at,
        last_active: a.last_active,
        badge_url: `${base}/api/agents/${a.id}/badge`,
        verify_url: `${base}/api/reputation/${a.id}`,
      };
    })
  );
  ranked.sort((a, b) => b.trust_score - a.trust_score || b.tasks_completed - a.tasks_completed);

  const total = count ?? ranked.length;
  return NextResponse.json({
    schema: "agentrider-registry/v1",
    platform: "AgentRider",
    platform_url: base,
    description: "Ranked registry of registered agents (by blended trust score + PoW). Not a KYC or every-agent-verified claim — riders are signed credentials peers check via JWKS. Optional ?q= or ?name= filters by display name (ilike). provenance is lab|external|smoke|unknown (default unknown) — origin label only, not KYC.",
    updated_at: new Date().toISOString(),
    poll_interval_seconds: 60,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    agents: ranked,
  });
}
