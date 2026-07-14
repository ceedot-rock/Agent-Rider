import { NextRequest, NextResponse } from "next/server";
import { verifyBadgeSignature, type TrustBadge } from "@/lib/badge";
import { verifyPoWChain, getBlendedTrustScore } from "@/lib/reputation";

export async function POST(req: NextRequest) {
  const badge = (await req.json().catch(() => null)) as TrustBadge | null;
  if (!badge?.signature || !badge.agent?.id) {
    return NextResponse.json({ error: "badge_object_with_signature_required" }, { status: 400 });
  }

  const { valid, expired } = verifyBadgeSignature(badge);
  const [liveChain, liveTrustScore] = await Promise.all([
    verifyPoWChain(badge.agent.id),
    getBlendedTrustScore(badge.agent.id),
  ]);

  const trustworthy = valid && !expired && liveChain.valid;

  return NextResponse.json({
    badge_valid: valid,
    badge_expired: expired,
    live_chain_valid: liveChain.valid,
    live_blended_trust_score: liveTrustScore,
    recommendation: trustworthy ? "TRUST — badge authentic, chain intact" : "VERIFY MANUALLY — badge invalid, expired, or chain broken",
  });
}
