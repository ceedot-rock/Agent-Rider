import { NextRequest, NextResponse } from "next/server";
import { resolveById } from "@/lib/agents";
import { ASM_DOMAINS, type AsmDomain, getReputation, agentAccuracy } from "@/lib/reputation";
import { getDB } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; domain: string }> }
) {
  const { agentId, domain } = await params;
  const participant = await resolveById(agentId);
  if (!participant) {
    return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
  }
  if (!ASM_DOMAINS.includes(domain as AsmDomain)) {
    return NextResponse.json(
      { error: "invalid_domain", valid_domains: ASM_DOMAINS },
      { status: 400 }
    );
  }

  const rep = await getReputation(agentId, domain as AsmDomain);
  const db = getDB();
  const { data: openClaims } = await db
    .from("asm_claims")
    .select("id, content, net_confidence, created_at")
    .eq("author_id", agentId)
    .eq("domain", domain)
    .eq("status", "open");

  return NextResponse.json({
    agentId,
    name: participant.name,
    domain,
    score: rep.score,
    correct: rep.correct,
    incorrect: rep.incorrect,
    totalStaked: rep.totalStaked,
    accuracy: agentAccuracy(rep),
    openClaims: (openClaims ?? []).map((c) => ({
      id: c.id,
      content: c.content.slice(0, 100),
      netConfidence: c.net_confidence,
      createdAt: c.created_at,
    })),
  });
}
