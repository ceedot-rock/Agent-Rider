import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, isCallerOk } from "@/lib/identity";
import { upsertCapability, validateCapabilityUpsert } from "@/lib/capabilities";

/**
 * Free capability upsert (self-only v0).
 * Auth: X-Agent-Rider or Authorization: Bearer ar_… — agent_id must match caller.
 * Does not meter. Discovery/registry stay free.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!isCallerOk(caller)) {
    return NextResponse.json(caller.body, {
      status: caller.status,
      headers: { ...CORS_HEADERS, ...(caller.headers ?? {}) },
    });
  }

  const body = await req.json().catch(() => null);
  const validated = validateCapabilityUpsert(body);
  if (validated.ok === false) {
    return NextResponse.json(
      { error: validated.error, detail: validated.detail },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Self-only v0 — cannot list for another agent_id.
  if (validated.value.agent_id !== caller.participant.id) {
    return NextResponse.json(
      {
        error: "self_only",
        hint: "v0 listing is self-only: agent_id must match the authenticated caller",
        your_agent_id: caller.participant.id,
      },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  const { capability, store, dbError } = await upsertCapability(validated.value);

  return NextResponse.json(
    {
      capability,
      store,
      db_error: dbError ?? null,
      free: true,
      note:
        "Listing is free. Metered verified lookup is POST /api/toll/v2/lookup (flag TOLL2_LOOKUP_LIVE). L3_attest is PARKED until host attest LIVE.",
    },
    { status: 201, headers: CORS_HEADERS }
  );
}
