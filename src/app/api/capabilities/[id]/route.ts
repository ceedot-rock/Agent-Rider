import { NextRequest, NextResponse } from "next/server";
import { getCapability } from "@/lib/capabilities";

/**
 * Free raw capability read. Self-asserted (L0) allowed; badge shows evidence level.
 * Does not meter.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  const params = await Promise.resolve(ctx.params);
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "missing_capability_id" }, { status: 400, headers: CORS_HEADERS });
  }

  const capability = await getCapability(id);
  if (!capability) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json(
    {
      capability,
      free: true,
      verified_badge: capability.trust.evidence_level !== "L0_self",
      note:
        "Free raw read. Paid verified lookup is POST /api/toll/v2/lookup. L3_attest PARKED until host attest LIVE.",
    },
    { headers: CORS_HEADERS }
  );
}
