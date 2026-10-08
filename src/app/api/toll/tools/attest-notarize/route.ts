import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import {
  TOOL_CORS_HEADERS,
  TOLL_TOOLS_OFF_BODY,
  TOOL_PRICE_LABELS,
  TOOL_PRICE_UUSDC_FLAT,
  isTollToolsLive,
  meterToolUse,
  buildToolReceiptPayload,
} from "@/lib/toll-tools";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxTool, type ToolValidateResult } from "@/lib/toll-sandbox";
import { signTollPayload } from "@/lib/toll-receipt";
import {
  newReceiptId,
  canonicalInputBytes,
  validateAttestNotarize,
  runAttestNotarize,
  ToolInputError,
} from "@/lib/toll-tools-wave1.mjs";

/**
 * POST /api/toll/tools/attest-notarize { payload: object }
 * Metered twin of the FREE public notarization endpoint at
 * /api/toll/public/attest — this route does NOT touch that endpoint; it
 * validates the shape itself and calls buildNotarizationPayload from
 * toll-public-core.mjs directly. Floats are refused (400).
 * 64KB body cap, matching the public endpoint.
 *
 * Price: flat 10,000 µUSDC ($0.01) per notarization.
 * Flag TOLL_TOOLS_LIVE default OFF → 503.
 */

const PRICE_UUSDC = TOOL_PRICE_UUSDC_FLAT["attest-notarize"] ?? 10_000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: TOOL_CORS_HEADERS });
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: TOOL_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isTollToolsLive()) {
    return NextResponse.json(TOLL_TOOLS_OFF_BODY, { status: 503, headers: TOOL_CORS_HEADERS });
  }

  if (isSandboxRequest(req)) {
    return sandboxTool(req, "attest-notarize", validateAttestNotarize as (body: unknown) => ToolValidateResult);
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validateAttestNotarize(body);
  if (!v.ok) {
    return bad(400, v.code, { reason: v.reason });
  }
  const input = v.value;

  let outcome;
  try {
    outcome = runAttestNotarize(input);
  } catch (err) {
    if ((err as { name?: string }).name === "ToolInputError") {
      return bad(400, (err as { code: string }).code);
    }
    throw err; // unexpected → fail closed
  }

  const usage = await checkMonthlyUsage(`tools:attest-notarize:${payer.payer_id}`, 0);

  const input_hash =
    "sha256:" + createHash("sha256").update(canonicalInputBytes("attest-notarize", outcome.detail.payload_hash as string)).digest("hex");
  const receipt_id = newReceiptId();
  const receiptPayload = buildToolReceiptPayload({
    tool: "attest-notarize",
    payer_id: payer.payer_id,
    price_uusdc: PRICE_UUSDC,
    result: outcome.result,
    input_hash,
    detail: outcome.detail,
  });

  let envelope;
  try {
    envelope = signTollPayload(receiptPayload);
  } catch {
    return bad(500, "signing_unavailable");
  }

  await meterToolUse("attest-notarize", PRICE_UUSDC, receipt_id);

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_UUSDC / 1_000_000,
      price_label: TOOL_PRICE_LABELS["attest-notarize"],
      receipt_id,
      result: outcome.result,
      envelope,
      usage: {
        callsThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: false,
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
      ...outcome.detail,
    },
    { headers: TOOL_CORS_HEADERS }
  );
}
