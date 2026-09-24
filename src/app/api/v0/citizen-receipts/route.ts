import { NextRequest, NextResponse } from "next/server";
import { resolveByApiKey } from "@/lib/agents";
import { findSubscriptionByMerchantKey } from "@/lib/stripe";
import {
  extractCitizenReceiptCandidate,
  validateCitizenReceiptShape,
} from "@/lib/cuni-citizen-gate";
import {
  bindCitizenReceipt,
  checkCitizenReceiptIngestAuth,
  extractCitizenReceiptBind,
  getCitizenReceiptByHash,
  CUNI_STUDIO_INGEST_KEY_ENV,
  CUNI_CITIZEN_RECEIPT_INGEST_OPEN_ENV,
} from "@/lib/cuni-citizen-receipt-store";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Merchant-Key, X-Cuni-Ingest-Key, X-Cuni-Studio, X-Agent-Rider",
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/CUNI_CITIZEN_GATE.md";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * POST /api/v0/citizen-receipts
 * Studio → Rider citizen-receipt HTTP receive (cutover).
 *
 * Auth (first match):
 *   1. Authorization: Bearer <CUNI_STUDIO_INGEST_KEY> or X-Cuni-Ingest-Key
 *   2. X-Merchant-Key (active/trialing Merchant Gate)
 *   3. Authorization: Bearer <participant api_key>
 *   4. Open only when CUNI_CITIZEN_RECEIPT_INGEST_OPEN=true
 *
 * Honesty: Rider RECEIVE only — does not call CuNi Studio.
 * Fund path = Rider settle / XPay (never PCC).
 */
export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const merchantKey = req.headers.get("x-merchant-key");
  const ingestHeader = req.headers.get("x-cuni-ingest-key");

  let merchantOk = false;
  if (merchantKey) {
    try {
      const subscription = await findSubscriptionByMerchantKey(merchantKey);
      merchantOk = Boolean(
        subscription && ACTIVE_STATUSES.has(subscription.status)
      );
    } catch {
      merchantOk = false;
    }
  }

  let apiKeyResolved = false;
  let agentIdFromKey: string | undefined;
  // Only treat Bearer as api_key when it is NOT the configured ingest key.
  const configuredIngest = process.env.CUNI_STUDIO_INGEST_KEY?.trim() || null;
  if (bearer && bearer !== configuredIngest) {
    try {
      const participant = await resolveByApiKey(bearer);
      if (participant) {
        apiKeyResolved = true;
        agentIdFromKey = participant.id;
      }
    } catch {
      apiKeyResolved = false;
    }
  }

  const auth = checkCitizenReceiptIngestAuth({
    bearer,
    ingestKeyHeader: ingestHeader,
    merchantKey,
    merchantOk,
    apiKeyResolved,
  });
  if (auth.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        hint: auth.hint,
        docs_url: DOCS,
        studio_roundtrip: "not_applicable",
        note: "Rider receive path only — does not call CuNi Studio",
      },
      { status: auth.status, headers: CORS }
    );
  }

  const body = await req.json().catch(() => null);
  const candidate = extractCitizenReceiptCandidate(body);
  if (candidate === undefined) {
    return NextResponse.json(
      {
        ok: false,
        error: "citizen_receipt_required",
        message:
          "Provide citizen_receipt (or citizenReceipt/receipt) with source_hash and exactness.passed === true",
        missing: ["citizen_receipt"],
        docs_url: DOCS,
        studio_roundtrip: "not_applicable",
      },
      { status: 400, headers: CORS }
    );
  }

  const shape = validateCitizenReceiptShape(candidate);
  if (shape.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: "citizen_receipt_invalid",
        message: shape.error,
        missing: shape.missing,
        docs_url: DOCS,
        studio_roundtrip: "not_applicable",
      },
      { status: 400, headers: CORS }
    );
  }

  const bind = extractCitizenReceiptBind(body);
  if (agentIdFromKey && !bind.agent_id) bind.agent_id = agentIdFromKey;

  const publisher =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).publisher === "string"
      ? String((body as Record<string, unknown>).publisher)
      : "studio";

  const result = await bindCitizenReceipt({
    receipt: shape.receipt,
    bind,
    publisher,
    ingress:
      auth.mode === "merchant"
        ? "merchant"
        : auth.mode === "api_key"
          ? "agent"
          : "studio_http",
  });

  if (result.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: "citizen_receipt_invalid",
        message: result.error,
        missing: result.missing,
        studio_roundtrip: "not_applicable",
      },
      { status: result.status, headers: CORS }
    );
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentrider.fly.dev";
  return NextResponse.json(
    {
      ok: true,
      receipt_id: result.record.id,
      source_hash: result.record.source_hash,
      exactness: result.record.exactness,
      bind: result.record.bind,
      idempotent: result.idempotent,
      ingress: result.record.ingress,
      auth_mode: auth.mode,
      received_at: result.record.received_at,
      endpoints: {
        self: `${base}/api/v0/citizen-receipts?hash=${encodeURIComponent(result.record.source_hash)}`,
      },
      studio_roundtrip: "not_applicable",
      note: "Receipt bound on Rider. Fund path = settle/XPay (never PCC). Rider does not call Studio.",
    },
    { status: result.idempotent ? 200 : 201, headers: CORS }
  );
}

/**
 * GET /api/v0/citizen-receipts?hash=<source_hash>
 * Lookup a previously bound PASS receipt (Execute gate helper).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get("hash") ?? searchParams.get("source_hash");
  if (!hash) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_hash",
        hint: "GET /api/v0/citizen-receipts?hash=<source_hash>",
      },
      { status: 400, headers: CORS }
    );
  }

  const record = await getCitizenReceiptByHash(hash);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: CORS }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      receipt_id: record.id,
      source_hash: record.source_hash,
      exactness: record.exactness,
      bind: record.bind,
      publisher: record.publisher,
      ingress: record.ingress,
      received_at: record.received_at,
      studio_roundtrip: "not_applicable",
    },
    { headers: CORS }
  );
}

export const _INGEST_ENV = {
  CUNI_STUDIO_INGEST_KEY_ENV,
  CUNI_CITIZEN_RECEIPT_INGEST_OPEN_ENV,
} as const;
