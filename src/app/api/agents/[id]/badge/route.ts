import { NextRequest, NextResponse } from "next/server";
import { buildBadge } from "@/lib/badge";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const badge = await buildBadge(id).catch(() => null);
  if (!badge) {
    return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      badge,
      usage: {
        header: "X-Agent-Trust-Badge: <base64-encoded badge JSON>",
        verify_endpoint: "/api/registry/verify-badge",
        note: "Attach this badge to outbound requests. Expires in 24h — re-fetch to refresh.",
        example_header: `X-Agent-Trust-Badge: ${Buffer.from(JSON.stringify(badge)).toString("base64")}`,
      },
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
