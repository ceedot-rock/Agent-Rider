import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportCapabilityLookup } from "@/lib/stripe";
import { isToll2LookupLive, TOLL2_LOOKUP_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import {
  EVIDENCE_LEVELS,
  filterAndRankCapabilities,
  listCapabilitiesForLookup,
  type EvidenceLevel,
} from "@/lib/capabilities";

/**
 * Toll 2 — metered verified-capability lookup @ $0.02 / request.
 * Flag TOLL2_LOOKUP_LIVE default OFF → 503 toll2_lookup_off (no charge).
 * Paid results: L1+ verified badge; L0 excluded from verified_only matches.
 * Does NOT meter /api/discovery or /api/registry.
 */

const PRICE_USD = 0.02;
// Optional free tier for lookup (default 0 — every live call is billable after flag ON).
const FREE_CALLS_PER_MONTH = Number(process.env.TOLL2_LOOKUP_FREE_CALLS_PER_MONTH ?? 0);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function parseMinEvidence(v: unknown): EvidenceLevel {
  if (typeof v === "string" && (EVIDENCE_LEVELS as readonly string[]).includes(v)) {
    return v as EvidenceLevel;
  }
  return "L1_receipt";
}

export async function POST(req: NextRequest) {
  if (!isToll2LookupLive()) {
    return NextResponse.json(TOLL2_LOOKUP_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const min_evidence = parseMinEvidence(body.min_evidence);
  const limit = typeof body.limit === "number" ? body.limit : 10;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [];
  const query = typeof body.query === "string" ? body.query : "";

  const usage = await checkMonthlyUsage(`toll2_lookup:${payer.payer_id}`, FREE_CALLS_PER_MONTH);
  let billed = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportCapabilityLookup(payer.stripe_customer_id);
    billed = true;
  } else if (usage.overLimit) {
    console.warn(
      "toll2 lookup overage without stripe_customer_id",
      payer.payer_id,
      "set STRIPE_CAPABILITY_LOOKUP_METER_NAME + link customer when ready"
    );
  }

  const caps = await listCapabilitiesForLookup();
  const matches = filterAndRankCapabilities(caps, {
    query,
    tags,
    min_evidence,
    limit,
    verified_only: true,
  });

  const receipt_id = `tv2_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_USD,
      receipt_id,
      query: { query, tags, min_evidence, limit },
      matches,
      note:
        "verified:true means L1_receipt or L2_exactness (L3_attest schema-ok but PARKED until host attest LIVE). Not KYC. Not a Warrant.",
      usage: {
        callsThisMonth: usage.count,
        freeLimit: FREE_CALLS_PER_MONTH,
        overage: usage.overLimit,
        billed,
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
