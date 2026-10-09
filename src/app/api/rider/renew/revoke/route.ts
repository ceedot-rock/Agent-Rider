import { NextRequest, NextResponse } from "next/server";
import { revokeRenewalToken, RenewalError } from "@/lib/rider-renewal";
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

// The holder of a renewal token kills its whole rotation chain, independently
// of any rider. Future renewals stop immediately; outstanding riders are
// untouched and die at their own 15-minute expiry.
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

  try {
    const r = await revokeRenewalToken(body.renewal_token);
    return NextResponse.json(
      { revoked: true, chain_id: r.chain_id },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    if (err instanceof RenewalError) {
      return NextResponse.json({ error: err.code }, { status: err.status, headers: CORS_HEADERS });
    }
    console.error("rider renewal revoke failed", err);
    return NextResponse.json({ error: "revoke_failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
