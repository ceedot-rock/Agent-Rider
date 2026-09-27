import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll4GrantIssue } from "@/lib/stripe";
import { isToll4GrantsLive, TOLL4_GRANTS_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { signTollPayload } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  ISSUE_TOLL_UUSDC,
  Toll4GrantError,
  buildGrantPayload,
} from "../../../../../../lib/toll-4-core.mjs";

/**
 * Toll 4 — delegation-grant issuance @ 1c (10_000 micro-USDC, metered).
 * Flag TOLL4_GRANTS_LIVE default OFF → 503 toll4_grants_off (no charge).
 * The lab signs as issuer. Money-state writes (toll_grants) fail closed;
 * the meter row is best-effort (fail-open).
 */

const PRICE_USD = 0.01;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function badBody(error: string, hint?: string) {
  return NextResponse.json({ error, ...(hint ? { hint } : {}) }, { status: 400, headers: CORS_HEADERS });
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export async function POST(req: NextRequest) {
  if (!isToll4GrantsLive()) {
    return NextResponse.json(TOLL4_GRANTS_OFF_BODY, { status: 503, headers: CORS_HEADERS });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: CORS_HEADERS });
  }

  const body = await req.json().catch(() => ({}));

  // Fail closed on malformed input — never mint a grant we can't describe.
  const grantor = body.grantor;
  const agent_id = body.agent_id;
  const scope = body.scope;
  const cap_uusdc = body.cap_uusdc;
  const not_before = body.not_before;
  const not_after = body.not_after;
  if (typeof grantor !== "string" || !grantor) return badBody("bad_grantor", "grantor must be a non-empty string");
  if (typeof agent_id !== "string" || !agent_id) return badBody("bad_agent_id", "agent_id must be a non-empty string");
  if (!Array.isArray(scope) || scope.length === 0 || !scope.every((a: unknown) => typeof a === "string" && a))
    return badBody("bad_scope", "scope must be a non-empty list of action strings");
  if (!isInt(cap_uusdc) || cap_uusdc <= 0)
    return badBody("bad_cap_uusdc", "cap_uusdc must be a positive integer (micro-USDC)");
  if (!isInt(not_before) || !isInt(not_after))
    return badBody("bad_window", "not_before/not_after must be integer epoch seconds");
  if (not_after <= not_before) return badBody("bad_window", "not_after must be after not_before");
  const revocable = body.revocable === undefined ? true : Boolean(body.revocable);

  const usage = await checkMonthlyUsage(`toll4_issue:${payer.payer_id}`, 0);
  let billed = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll4GrantIssue(payer.stripe_customer_id);
    billed = true;
  } else if (usage.overLimit) {
    console.warn(
      "toll4 grant issue overage without stripe_customer_id",
      payer.payer_id,
      "link Stripe customer when ready"
    );
  }

  let grant_id: string;
  let envelope: Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  try {
    const built = buildGrantPayload({ grantor, agent_id, scope, cap_uusdc, not_before, not_after, revocable, issued_at: now });
    grant_id = built.grant_id;
    envelope = signTollPayload(built.payload) as unknown as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Toll4GrantError) return badBody("bad_grant_request", (err as Error).message);
    console.error("toll4 grant issue: signing failed", (err as Error).message);
    return NextResponse.json({ error: "grant_signing_failed" }, { status: 500, headers: CORS_HEADERS });
  }

  const db = getDB();

  // Money-state write: fail closed — no grant row, no issuance.
  const { error: grantErr } = await db.from("toll_grants").insert({
    grant_id,
    envelope_json: envelope,
    grantor,
    agent_id,
    cap_uusdc,
    not_before,
    not_after,
    issued_at: now,
  });
  if (grantErr) {
    console.error("toll4 grant issue: toll_grants insert failed", grantErr.message);
    return NextResponse.json({ error: "grant_store_failed" }, { status: 500, headers: CORS_HEADERS });
  }

  // Meter row: fail-open — a meter outage must not take down issuance.
  const { error: meterErr } = await db.from("toll_meter").insert({
    module: "grants",
    operation: "issue",
    amount_uusdc: ISSUE_TOLL_UUSDC,
    ref_id: grant_id,
    created_at: now,
  });
  if (meterErr) console.warn("toll4 grant issue: toll_meter insert failed (fail-open)", meterErr.message);

  const receipt_id = `t4i_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_USD,
      receipt_id,
      grant_id,
      envelope,
      usage: {
        callsThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed,
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
    },
    { headers: CORS_HEADERS }
  );
}
