import { NextRequest, NextResponse } from "next/server";
import { verifyRider } from "@/lib/rider";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = body.rider ?? req.headers.get("x-agent-rider");

  if (!token) {
    return NextResponse.json({ error: "missing_rider" }, { status: 400, headers: CORS_HEADERS });
  }

  const result = await verifyRider(token);
  return NextResponse.json(result, { headers: CORS_HEADERS });
}
