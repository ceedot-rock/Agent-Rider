import { NextResponse } from "next/server";
import { tollSchemaDoc } from "@/lib/toll-schemas";

/**
 * GET /api/toll/schema — machine-readable discovery for every toll endpoint.
 *
 * An agent that gets a 400/401 from any toll route fetches this instead of
 * guessing field shapes. No auth needed: schemas are public.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  return NextResponse.json(tollSchemaDoc(), { headers: CORS_HEADERS });
}
