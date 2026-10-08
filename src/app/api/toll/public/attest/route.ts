import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import { signTollPayload, TollReceiptError } from "@/lib/toll-receipt";
import {
  MAX_BODY_BYTES,
  buildExactnessAttestation,
  buildNotarizationPayload,
  checkPublicAttestLimit,
  classifyAttestShape,
  isBodyTooLarge,
  publicAttestMaxPerHour,
} from "@/lib/toll-public-core.mjs";
import { OracleError } from "@/lib/toll-5-core.mjs";

/**
 * Toll public attestation — the no-account path.
 * POST /api/toll/public/attest
 *
 * No auth. No account. No billing. No metering. No DB writes.
 * Anyone can POST a payload and get back a lab-signed receipt envelope,
 * verifiable offline against /.well-known/jwks.json.
 *
 * Shapes:
 *   {"payload": {...}}           → notarization ("the lab saw this at time T")
 *   {"artifact": {...}, "claim"} → exactness check (same pipeline as v5)
 *
 * Guards: 64KB body cap (413), floats refused (400), per-IP
 * 60 req/hour (429 + retry_after). Missing signing key → 500, fail closed.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { public: true, error, ...extra },
    { status, headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  // Rate limit first: free signing endpoint, fail closed by construction
  // (in-process limiter has no external outage mode).
  const ip = getClientIp(req);
  const limit = checkPublicAttestLimit(ip);
  if (!limit.ok) {
    return bad(429, "rate_limited", {
      retry_after: limit.retryAfter,
      limit_per_hour: publicAttestMaxPerHour(),
    });
  }

  // Size cap on the raw body before parsing.
  const raw = await req.text().catch(() => null);
  if (raw === null || isBodyTooLarge(raw)) {
    return bad(413, "payload_too_large", { max_body_bytes: MAX_BODY_BYTES });
  }
  const body = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();

  const shape = classifyAttestShape(body);
  if (shape === "unknown") {
    return bad(400, "unknown_shape", {
      hint: 'send {"payload": {...}} for notarization or {"artifact": {...}, "claim": {...}} for an exactness check — not both',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  let receiptPayload: Record<string, unknown>;
  let mode: string;
  let extra: Record<string, unknown> = {};
  try {
    if (shape === "notarization") {
      // canonicalJson inside throws TollReceiptError on floats → 400.
      receiptPayload = buildNotarizationPayload({
        payload: body.payload,
        attested_at: now,
      });
      mode = "notarization";
    } else {
      // Same exactness pipeline as the live v5 gate. OracleError → 400.
      const att = buildExactnessAttestation({
        artifact: body.artifact,
        claim: body.claim,
        checked_at: now,
      });
      receiptPayload = att.payload;
      mode = "exactness";
      extra = { result: att.result };
    }
  } catch (err) {
    if (err instanceof OracleError)
      return bad(400, "malformed_check_request", {
        reason: (err as Error).message,
      });
    if (err instanceof TollReceiptError)
      return bad(400, "floats_refused", { reason: (err as Error).message });
    throw err; // fail closed: unexpected errors never produce a receipt
  }

  // Sign with the lab key. Throws (500) without RIDER_PRIVATE_KEY —
  // fail closed: an unsigned receipt is never returned.
  let envelope;
  try {
    envelope = signTollPayload(receiptPayload);
  } catch (err) {
    console.error(
      "public attest: signing failed",
      err instanceof Error ? err.message : err
    );
    return bad(500, "signing_unavailable");
  }

  return NextResponse.json(
    {
      public: true,
      live: true,
      mode,
      envelope,
      verify: {
        jwks_url: "/.well-known/jwks.json",
        note: "verify offline with any ES256/JWKS tooling — the receipt never phones home",
      },
      ...extra,
    },
    { headers: CORS_HEADERS }
  );
}
