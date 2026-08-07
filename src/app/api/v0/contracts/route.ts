import { NextRequest, NextResponse } from "next/server";
import {
  registerCuniContract,
  listCuniContracts,
  getCuniContract,
} from "@/lib/cuni-contracts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Rider",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/v0/contracts
 * Accept verified CuNi publish metadata. Requires exactness.passed === true.
 * Idempotent on sourceHash.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await registerCuniContract(body);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "error" in result ? result.error : "register_failed" },
      { status: "status" in result ? result.status : 400, headers: CORS }
    );
  }

  const c = result.contract;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentrider.vercel.app";

  return NextResponse.json(
    {
      ok: true,
      contractId: c.id,
      status: c.status,
      sourceHash: c.source_hash,
      idempotent: result.idempotent,
      endpoints: {
        self: `${base}/api/v0/contracts?id=${c.id}`,
        invoke: `${base}/api/v0/contracts/${c.id}/invoke`,
      },
      registeredAt: c.created_at ?? c.published_at,
    },
    { status: result.idempotent ? 200 : 201, headers: CORS }
  );
}

/**
 * GET /api/v0/contracts
 * List recent contracts, or fetch one by ?id= / ?hash=
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? searchParams.get("hash");

  if (id) {
    const c = await getCuniContract(id);
    if (!c) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: CORS }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        contract: {
          id: c.id,
          sourceHash: c.source_hash,
          exactness: c.exactness,
          links: c.links,
          publisher: c.publisher,
          publishedAt: c.published_at,
          status: c.status,
          createdAt: c.created_at,
          // source intentionally omitted from list/detail by default for size;
          // include with ?full=1
          ...(searchParams.get("full") === "1" ? { source: c.source } : {}),
        },
      },
      { headers: CORS }
    );
  }

  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);
  const rows = await listCuniContracts(limit);
  return NextResponse.json(
    {
      ok: true,
      count: rows.length,
      contracts: rows.map((c) => ({
        id: c.id,
        sourceHash: c.source_hash,
        exactness: c.exactness,
        publisher: c.publisher,
        publishedAt: c.published_at,
        status: c.status,
        createdAt: c.created_at,
      })),
    },
    { headers: CORS }
  );
}
