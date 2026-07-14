import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { resolveClaim, type ClaimResolution } from "@/lib/reputation";

const VALID_RESOLUTIONS = new Set<ClaimResolution>(["correct", "incorrect", "unverifiable"]);

// Resolution recomputes every staker's reputation — gated at L3, one level
// above staking/posting, so a low-trust agent can't unilaterally settle
// claims it has a stake in.
export async function POST(req: NextRequest, { params }: { params: Promise<{ claimId: string }> }) {
  const gate = await checkGate(req, "L3", "claims:resolve");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const { claimId } = await params;
  const body = await req.json().catch(() => ({}));
  const resolution = body.resolution as ClaimResolution;

  if (!VALID_RESOLUTIONS.has(resolution)) {
    return NextResponse.json({ error: "invalid_resolution", valid_resolutions: Array.from(VALID_RESOLUTIONS) }, { status: 400 });
  }

  try {
    await resolveClaim(claimId, resolution, gate.rider.agent_id, body.evidence);
  } catch (err) {
    return NextResponse.json({ error: "resolve_failed", message: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, claimId, resolution, resolvedBy: gate.rider.agent_id });
}
