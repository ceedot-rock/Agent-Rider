import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { reportToll4GrantCheck } from "@/lib/stripe";
import { isToll4GrantsLive, TOLL4_GRANTS_OFF_BODY } from "@/lib/toll-flags";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { TollReceiptError, verifyTollEnvelope } from "@/lib/toll-receipt";
import { getDB } from "@/lib/db";
import {
  CHECK_TOLL_UUSDC,
  DEFAULT_REVOCATION_MAX_AGE,
  checkGrantPure,
} from "../../../../../../lib/toll-4-core.mjs";

/**
 * Toll 4 — delegation-grant check @ 0.5c (5_000 micro-USDC, metered).
 * Flag TOLL4_GRANTS_LIVE default OFF → 503 toll4_grants_off (no charge).
 *
 * Caller supplies the grantor's JWKS (REQUIRED — the route verifies the
 * grant envelope against it; it never fetches keys on its own).
 *
 * Fail-closed revocation: the route does a live toll_revocations read per
 * check and passes revocationCheckedAt = now. If that read fails, the check
 * is refused with revocation_check_stale rather than trusting a possibly
 * stale cached timestamp.
 */

const PRICE_USD = 0.005;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function grantRef(envelope: unknown): string {
  try {
    const p = (envelope as { payload?: { grant_id?: unknown } }).payload;
    return typeof p?.grant_id === "string" ? p.grant_id : "unknown";
  } catch {
    return "unknown";
  }
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
  const grant_envelope = body.grant_envelope;
  const action = body.action;
  const amount_uusdc = body.amount_uusdc;
  const jwks = body.jwks;

  if (!jwks || typeof jwks !== "object")
    return NextResponse.json({ error: "missing_jwks", hint: "grantor JWKS is required: {keys:[...]} or {kid:jwk}" }, { status: 400, headers: CORS_HEADERS });
  if (typeof action !== "string" || !action)
    return NextResponse.json({ error: "bad_action", hint: "action must be a non-empty string" }, { status: 400, headers: CORS_HEADERS });
  if (!isInt(amount_uusdc) || amount_uusdc < 0)
    return NextResponse.json({ error: "bad_amount_uusdc", hint: "amount_uusdc must be an integer >= 0 (micro-USDC)" }, { status: 400, headers: CORS_HEADERS });

  const revocationCheckedAt =
    body.revocation_checked_at === undefined ? null : body.revocation_checked_at;
  if (revocationCheckedAt !== null && !isInt(revocationCheckedAt))
    return NextResponse.json({ error: "bad_revocation_checked_at", hint: "revocation_checked_at must be an integer epoch or omitted" }, { status: 400, headers: CORS_HEADERS });

  const usage = await checkMonthlyUsage(`toll4_check:${payer.payer_id}`, 0);
  let billed = false;
  if (usage.overLimit && payer.stripe_customer_id) {
    await reportToll4GrantCheck(payer.stripe_customer_id);
    billed = true;
  } else if (usage.overLimit) {
    console.warn(
      "toll4 grant check overage without stripe_customer_id",
      payer.payer_id,
      "link Stripe customer when ready"
    );
  }

  const db = getDB();
  const now = Math.floor(Date.now() / 1000);

  // Verify first — bad_signature short-circuits before any DB read, and is
  // still metered (like Python's check_grant: every call meters).
  let payload: Record<string, unknown> | null = null;
  let allowed = false;
  let reason = "bad_signature";
  try {
    payload = verifyTollEnvelope(grant_envelope, jwks) as Record<string, unknown>;
  } catch (err) {
    if (!(err instanceof TollReceiptError)) throw err;
  }

  if (payload) {
    const grant_id = typeof payload.grant_id === "string" ? payload.grant_id : "unknown";

    // Live revocation read — DB read failure fails closed as
    // revocation_check_stale (we cannot prove the grant is unrevoked).
    const { data: revRow, error: revErr } = await db
      .from("toll_revocations")
      .select("grant_id")
      .eq("grant_id", grant_id)
      .maybeSingle();
    if (revErr) {
      console.error("toll4 grant check: toll_revocations read failed", revErr.message);
      reason = "revocation_check_stale";
    } else {
      // Spend total — a failed spend read also fails closed (cap cannot be
      // proven), reported as cap_exceeded so the grant is never authorized
      // on unproven money.
      const { data: spendRows, error: spendErr } = await db
        .from("toll_grant_spends")
        .select("amount_uusdc")
        .eq("grant_id", grant_id);
      if (spendErr) {
        console.error("toll4 grant check: toll_grant_spends read failed", spendErr.message);
        reason = "cap_exceeded";
      } else {
        const spentTotal = (spendRows ?? []).reduce(
          (sum: number, r: { amount_uusdc: unknown }) =>
            sum + (typeof r.amount_uusdc === "number" ? r.amount_uusdc : 0),
          0
        );
        const decision = checkGrantPure({
          grantPayload: payload,
          action,
          amount_uusdc,
          now,
          revoked: revRow !== null,
          revocationCheckedAt: revocationCheckedAt === null ? now : revocationCheckedAt,
          maxAge: DEFAULT_REVOCATION_MAX_AGE,
          spentTotal,
        });
        allowed = decision.allowed;
        reason = decision.reason;
      }
    }
  }

  // Meter row: fail-open.
  const ref = payload && typeof payload.grant_id === "string" ? payload.grant_id : grantRef(grant_envelope);
  const { error: meterErr } = await db.from("toll_meter").insert({
    module: "grants",
    operation: "check",
    amount_uusdc: CHECK_TOLL_UUSDC,
    ref_id: ref,
    created_at: now,
  });
  if (meterErr) console.warn("toll4 grant check: toll_meter insert failed (fail-open)", meterErr.message);

  const receipt_id = `t4c_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_USD,
      receipt_id,
      allowed,
      reason,
      grant_id: ref,
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
