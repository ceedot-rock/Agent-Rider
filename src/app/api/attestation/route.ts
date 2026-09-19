import { NextRequest, NextResponse } from "next/server";
import {
  hostAttestationPlannedBody,
  HOST_ATTESTATION_HTTP_STATUS,
} from "@/lib/host-attestation";

/**
 * Host attestation evidence entry — PARKED NOT LIVE.
 * Always 501 { error: "host_attestation_planned", status: "not_live" }.
 * Does not produce Nitro/SEV quotes.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json(hostAttestationPlannedBody(), {
    status: HOST_ATTESTATION_HTTP_STATUS,
  });
}
