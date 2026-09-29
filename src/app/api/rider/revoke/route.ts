import { NextRequest, NextResponse } from "next/server";
import { revoke, verifyRider } from "@/lib/rider";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// The holder of a still-valid rider kills that credential. The jti lands on
// the public revocation list; verifiers reject it before the 15-minute expiry.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = (typeof body.rider === "string" ? body.rider : null) ?? req.headers.get("x-agent-rider");
  if (!token) {
    return NextResponse.json({ error: "missing_rider" }, { status: 400, headers: CORS_HEADERS });
  }
  const result = await verifyRider(token);
  if (!result.valid || !result.rider?.jti) {
    return NextResponse.json(
      { error: "invalid_rider", reason: result.reason ?? "invalid_token" },
      { status: 401, headers: CORS_HEADERS }
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "holder_revoke";
  await revoke(result.rider.jti, result.rider.agent_id, reason);
  return NextResponse.json(
    { revoked: true, jti: result.rider.jti },
    { headers: CORS_HEADERS }
  );
}
