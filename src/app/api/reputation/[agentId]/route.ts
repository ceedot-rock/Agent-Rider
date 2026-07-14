import { NextRequest, NextResponse } from "next/server";
import { resolveById } from "@/lib/agents";
import { ASM_DOMAINS, getReputation, getAsmTrustScore, getPowScore, getBlendedTrustScore } from "@/lib/reputation";
import { getDB } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const participant = await resolveById(agentId);
  if (!participant) {
    return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
  }

  const domainScores: Record<string, unknown> = {};
  for (const domain of ASM_DOMAINS) {
    domainScores[domain] = await getReputation(agentId, domain);
  }

  const db = getDB();
  const [{ count: claimsPosted }, { count: openClaims }, { count: resolvedClaims }, { data: stakes }] =
    await Promise.all([
      db.from("asm_claims").select("id", { count: "exact", head: true }).eq("author_id", agentId),
      db.from("asm_claims").select("id", { count: "exact", head: true }).eq("author_id", agentId).eq("status", "open"),
      db.from("asm_claims").select("id", { count: "exact", head: true }).eq("author_id", agentId).eq("status", "resolved"),
      db.from("asm_stakes").select("amount").eq("agent_id", agentId),
    ]);

  return NextResponse.json({
    agentId,
    name: participant.name,
    type: participant.type,
    asmTrustScore: await getAsmTrustScore(agentId),
    powScore: await getPowScore(agentId),
    blendedTrustScore: await getBlendedTrustScore(agentId),
    domainReputation: domainScores,
    activity: {
      claimsPosted: claimsPosted ?? 0,
      openClaims: openClaims ?? 0,
      resolvedClaims: resolvedClaims ?? 0,
      stakesPlaced: stakes?.length ?? 0,
      totalAgcStaked: (stakes ?? []).reduce((sum, s) => sum + s.amount, 0),
    },
  });
}
