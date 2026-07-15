import { NextResponse } from "next/server";
import { getJwks } from "@/lib/rider";

// Publishes the rider-signing key's public half so any third-party gate can
// verify a rider locally (jwtVerify against this JWKS) instead of calling
// back to POST /api/rider/verify — the actual mechanism behind "one
// verification, carried everywhere." Standard, cacheable location per
// RFC 8414 / the common /.well-known/jwks.json convention used by OAuth and
// OIDC providers, so existing JWT tooling (e.g. a jwks-rsa / jose remote
// JWKS client) finds it without platform-specific docs.
export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
