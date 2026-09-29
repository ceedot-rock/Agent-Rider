import { NextResponse } from "next/server";
import { listRevoked } from "@/lib/rider";

// Public cancellation list. Verifiers fetch this with the JWKS and reject
// any rider whose jti is present. A failed read is 503, never an empty list.
export async function GET() {
  const listed = await listRevoked();
  if (!listed.ok) {
    return NextResponse.json(
      { error: "revocation_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { issuer: "agentrider.dev", revoked: listed.rows },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
