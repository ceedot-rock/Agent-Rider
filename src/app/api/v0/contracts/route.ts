import { NextRequest, NextResponse } from "next/server";
import {
  registerCuniContract,
  listCuniContracts,
  getCuniContract,
} from "@/lib/cuni-contracts";
import {
  checkCitizenReceiptGate,
  isCitizenGateOk,
  extractCitizenReceiptCandidate,
} from "@/lib/cuni-citizen-gate";
import { bindCitizenReceipt } from "@/lib/cuni-citizen-receipt-store";
import { verifySealedRideForExecute } from "@/lib/sealed-ride-envelope";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Agent-Rider, X-Cuni-Studio, X-Cuni-Ingest-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/v0/contracts
 * Accept verified CuNi publish metadata. Requires exactness.passed === true.
 * Idempotent on sourceHash.
 * Citizen receipt gate: validate-when-present; strict via CUNI_CITIZEN_RECEIPT_REQUIRED.
 * When citizen_receipt (or publish-meta PASS) is present, also binds it for Execute lookup
 * (compat with Studio publish push — preferred dedicated path is POST /api/v0/citizen-receipts).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const citizenGate = checkCitizenReceiptGate(body);
  if (!isCitizenGateOk(citizenGate)) {
    return NextResponse.json(citizenGate.body, {
      status: citizenGate.status,
      headers: CORS,
    });
  }

  // Sealed ride execute gate — off-by-default; refuse unbound/invalid when required.
  {
    const sealed = verifySealedRideForExecute(
      body && typeof body === "object"
        ? (body as Record<string, unknown>).sealed_ride ??
          (body as Record<string, unknown>).sealedRide
        : undefined
    );
    if (sealed.ok === false) {
      return NextResponse.json(sealed.body, { status: sealed.status, headers: CORS });
    }
  }

  const result = await registerCuniContract(body);

  if (result.ok === false) {
    return NextResponse.json(
      { ok: false, error: "error" in result ? result.error : "register_failed" },
      { status: "status" in result ? result.status : 400, headers: CORS }
    );
  }

  const c = result.contract;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentrider.fly.dev";

  const bodyObj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const metaObj =
    bodyObj && bodyObj.meta && typeof bodyObj.meta === "object"
      ? (bodyObj.meta as Record<string, unknown>)
      : null;
  const studioMarker =
    bodyObj &&
    (bodyObj.studio === "called" ||
      metaObj?.studio === "called" ||
      req.headers.get("x-cuni-studio")?.toLowerCase() === "called")
      ? "called"
      : undefined;

  // Bind PASS receipt to this contract when present (Studio cutover compat).
  let receiptBound: { receipt_id: string; source_hash: string } | null = null;
  const receiptCandidate =
    citizenGate.receipt ?? extractCitizenReceiptCandidate(body);
  if (receiptCandidate) {
    const bound = await bindCitizenReceipt({
      receipt: receiptCandidate,
      bind: { contract_id: c.id },
      publisher: c.publisher ?? "studio",
      ingress: "contracts_register",
    });
    if (bound.ok) {
      receiptBound = {
        receipt_id: bound.record.id,
        source_hash: bound.record.source_hash,
      };
    }
  }

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
        citizen_receipt: receiptBound
          ? `${base}/api/v0/citizen-receipts?hash=${encodeURIComponent(receiptBound.source_hash)}`
          : `${base}/api/v0/citizen-receipts`,
      },
      registeredAt: c.created_at ?? c.published_at,
      // ACK Studio push (CuNi publish → contracts) when receipt PASS was accepted.
      ...(citizenGate.receipt
        ? {
            citizen_receipt: {
              source_hash: citizenGate.receipt.source_hash,
              exactness: { passed: true as const },
            },
            citizen_receipt_accepted: true,
          }
        : {}),
      ...(receiptBound
        ? {
            citizen_receipt_id: receiptBound.receipt_id,
            citizen_receipt_bound: true,
          }
        : { citizen_receipt_bound: false }),
      ...(studioMarker ? { studio: studioMarker } : {}),
      // Local receive only — this route does not HTTP-call Studio.
      studio_roundtrip: "not_applicable",
    },
    { status: result.idempotent ? 200 : 201, headers: CORS }
  );
}

/**
 * GET /api/v0/contracts
 * List recent contracts, or fetch one by ?id= / ?hash=
 */
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_supabase_service_role",
        hint: "fly secrets set SUPABASE_SERVICE_ROLE_KEY=... -a agentrider",
      },
      { status: 503, headers: CORS }
    );
  }
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
