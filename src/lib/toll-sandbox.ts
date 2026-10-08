/**
 * Toll-gate corruption sandbox — Next.js adapter.
 *
 * Public demo credential: TOLL_SANDBOX_DEMO_KEY (default "sk_sandbox_demo",
 * documented in SANDBOX.md). Presenting it as `Authorization: Bearer …` or
 * `X-Merchant-Key` routes the request into the sandbox handlers below, which
 * run the FULL validation pipeline with ZERO side effects:
 *   - no DB writes (no attestation rows, no meter rows)
 *   - no attestation signing (no envelope is ever minted)
 *   - no metering, no Stripe reports, no settlement, no charge
 *
 * The demo key can NEVER authorize a real dispatch:
 *   1. Routes branch to the sandbox handler BEFORE resolveTollPayer.
 *   2. resolveTollPayer explicitly rejects the demo key (defense in depth).
 *   3. Sandbox handlers never call signTollPayload or any write path.
 *
 * Fail closed everywhere: any error in sandbox mode returns a refusal,
 * never an allow.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRider } from "./rider";
import { getDB } from "./db";
import {
  isSandboxCredential,
  sandboxV1Decide,
  sandboxV4Policy,
  sandboxV4Verify,
  sandboxV5Decide,
} from "./toll-sandbox-core.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

/** True when this request carries the public demo key (either header). */
export function isSandboxRequest(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer =
    auth && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : null;
  const merchant = req.headers.get("x-merchant-key");
  return isSandboxCredential(bearer, merchant);
}

function sandboxJson(out: { http_status?: number; [k: string]: unknown }) {
  const { http_status, ...body } = out;
  return NextResponse.json(
    { sandbox: true, ...body },
    { status: http_status ?? 200, headers: CORS_HEADERS }
  );
}

// ── v1: rider-JWT verify ────────────────────────────────────────────────

export async function sandboxV1(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = body.rider ?? req.headers.get("x-agent-rider");
  let verifyResult: { valid: boolean; reason?: string } | null = null;
  if (typeof token === "string" && token) {
    try {
      verifyResult = await verifyRider(token);
    } catch {
      // verifyRider is not supposed to throw; fail closed if it does.
      verifyResult = { valid: false, reason: "verifier_error" };
    }
  }
  const out = sandboxV1Decide({ token, verifyResult });
  return sandboxJson(out);
}

// ── v4: delegation-grant check ──────────────────────────────────────────

export async function sandboxV4(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const now = Math.floor(Date.now() / 1000);

  // Phase 1 — pure: input shape + envelope signature.
  const pre = sandboxV4Verify({
    grant_envelope: body.grant_envelope,
    jwks: body.jwks,
    action: body.action,
    amount_uusdc: body.amount_uusdc,
    revocationCheckedAt:
      body.revocation_checked_at === undefined ? null : body.revocation_checked_at,
  });
  if (pre.decision === "refuse" || !pre.payload) {
    return sandboxJson(pre);
  }
  const payload = pre.payload as { grant_id?: unknown };
  const grant_id = typeof payload.grant_id === "string" ? payload.grant_id : "unknown";

  // Phase 2 — read-only DB lookups, fail closed exactly like the live route.
  // No writes happen anywhere in this handler.
  let db;
  try {
    db = getDB();
  } catch (err) {
    console.error("sandbox v4: toll store unavailable", (err as Error).message);
    return sandboxJson({
      decision: "refuse",
      refusal_code: "toll_store_unavailable",
      checks_run: [...pre.checks_run, "revocation_lookup"],
      http_status: 500,
    });
  }

  let revoked: boolean;
  try {
    const { data: revRow, error: revErr } = await db
      .from("toll_revocations")
      .select("grant_id")
      .eq("grant_id", grant_id)
      .maybeSingle();
    if (revErr) throw revErr;
    revoked = revRow !== null;
  } catch (err) {
    console.error("sandbox v4: revocation read failed", (err as Error).message);
    return sandboxJson({
      decision: "refuse",
      refusal_code: "revocation_check_stale",
      checks_run: [...pre.checks_run, "revocation_lookup"],
      http_status: 200,
    });
  }

  let spentTotal: number;
  try {
    const { data: spendRows, error: spendErr } = await db
      .from("toll_grant_spends")
      .select("amount_uusdc")
      .eq("grant_id", grant_id);
    if (spendErr) throw spendErr;
    spentTotal = (spendRows ?? []).reduce(
      (sum: number, r: { amount_uusdc: unknown }) =>
        sum + (typeof r.amount_uusdc === "number" ? r.amount_uusdc : 0),
      0
    );
  } catch (err) {
    console.error("sandbox v4: spend read failed", (err as Error).message);
    return sandboxJson({
      decision: "refuse",
      refusal_code: "cap_exceeded",
      checks_run: [...pre.checks_run, "revocation_lookup", "spend_lookup"],
      http_status: 200,
    });
  }

  // Phase 3 — pure grant policy.
  const out = sandboxV4Policy({
    payload: pre.payload as Record<string, unknown>,
    action: body.action,
    amount_uusdc: body.amount_uusdc,
    revocationCheckedAt:
      body.revocation_checked_at === undefined ? null : body.revocation_checked_at,
    now,
    revoked,
    spentTotal,
    checks_run: pre.checks_run,
  });
  return sandboxJson(out);
}

// ── v5: exactness check ─────────────────────────────────────────────────

export async function sandboxV5(req: NextRequest) {
  const body = await req.json().catch(() => null);
  // Fully pure — the live pipeline has no DB reads either. No attestation
  // is signed or stored here; the decision is the whole product.
  const out = sandboxV5Decide({ artifact: body?.artifact, claim: body?.claim });
  return sandboxJson(out);
}

// ── Toll Tools: generic sandbox branch ──────────────────────────────────
// Each tool route calls sandboxTool(req, "<tool-name>", validateFn) when the
// request carries the demo key. The validator is the SAME function the live
// route uses (imported from the wave's core module), so sandbox and live
// agree on input shape. Sandbox never signs, writes, meters, or dispatches:
// it returns the validation verdict only.

export type ToolValidateResult =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; code: string; reason?: string };

export async function sandboxTool(
  req: NextRequest,
  tool: string,
  validate: (body: unknown) => ToolValidateResult
) {
  const body = await req.json().catch(() => null);
  let v: ToolValidateResult;
  try {
    v = validate(body);
  } catch {
    return sandboxJson({
      decision: "refuse",
      refusal_code: "malformed_tool_request",
      checks_run: ["input_shape", tool],
      http_status: 400,
    });
  }
  if (!v.ok) {
    return sandboxJson({
      decision: "refuse",
      refusal_code: v.code,
      reason: v.reason,
      checks_run: ["input_shape", tool],
      http_status: 400,
    });
  }
  return sandboxJson({
    decision: "allow",
    refusal_code: null,
    checks_run: ["input_shape", tool],
    detail: v.detail ?? {},
  });
}
