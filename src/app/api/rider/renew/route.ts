import { NextRequest, NextResponse } from "next/server";
import { redeemRenewalToken, RenewalError } from "@/lib/rider-renewal";
import { checkRiderIssueLimit, getClientIp } from "@/lib/rate-limit";
import {
  assertAttestationForSensitiveOp,
  readAttestationEvidence,
} from "@/lib/attestation-evidence";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/rider/renew — exchange a renewal token for a fresh 15-minute rider.
//
// Rotation: every success burns the presented token (single-use) and returns a
// new renewal token on the same chain. Presenting an already-rotated token is
// treated as compromise: the agent's renewal chains are revoked.
//
// Riders stay 15 minutes fixed — there is deliberately no expiry parameter on
// this endpoint. The renewal token (default 30d, server env only) is the
// long-lived credential; it is independently revocable.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Host attestation fail-closed when ATTESTATION_REQUIRED=1 (mirrors /issue).
  {
    const evidence = readAttestationEvidence({
      headerJson: req.headers.get("x-attestation-evidence"),
      body,
    });
    const att = assertAttestationForSensitiveOp(evidence);
    if (att.ok === false) {
      return NextResponse.json(att.body, { status: att.status, headers: CORS_HEADERS });
    }
  }

  const rl = await checkRiderIssueLimit(`renew:${getClientIp(req)}`);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit_exceeded",
        retry_after: rl.retryAfter,
        hint: "too many rider renewals; wait and retry",
      },
      {
        status: 429,
        headers: { ...CORS_HEADERS, "retry-after": String(rl.retryAfter) },
      }
    );
  }

  try {
    const r = await redeemRenewalToken(
      body.renewal_token,
      typeof body.agent_id === "string" ? body.agent_id : undefined
    );
    return NextResponse.json(
      {
        rider: r.rider,
        jti: r.jti,
        expires_in: r.expires_in,
        renewal_token: r.renewal_token,
        renewal_expires_in: r.renewal_expires_in,
        agent_id: r.agent_id,
        header_to_send: "X-Agent-Rider",
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    if (err instanceof RenewalError) {
      return NextResponse.json({ error: err.code }, { status: err.status, headers: CORS_HEADERS });
    }
    console.error("rider renew failed", err);
    return NextResponse.json({ error: "renew_failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
