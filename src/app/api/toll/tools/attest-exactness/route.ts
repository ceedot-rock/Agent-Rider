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
  validateAttestExactness,
  runAttestExactness,
  ToolInputError,
} from "@/lib/toll-tools-wave1.mjs";
import { OracleError } from "@/lib/toll-5-core.mjs";

/**
 * POST /api/toll/tools/attest-exactness { artifact: object, claim: object }
 * Metered exactness attestation: runs the v5 exactness pipeline via
 * buildExactnessAttestation from toll-public-core.mjs. OracleError →
 * 400 malformed_check_request. Result pass/refuse comes from the
 * attestation; signed receipt either way.
 *
 * Price: flat 50,000 µUSDC ($0.05) per check.
 * Flag TOLL_TOOLS_LIVE default OFF → 503.
 */

const PRICE_UUSDC = TOOL_PRICE_UUSDC_FLAT["attest-exactness"] ?? 50_000;

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
    return sandboxTool(req, "attest-exactness", validateAttestExactness as (body: unknown) => ToolValidateResult);
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validateAttestExactness(body);
  if (!v.ok) {
    return bad(400, v.code, { reason: v.reason });
  }
  const input = v.value;

  let outcome;
  try {
    outcome = runAttestExactness(input);
  } catch (err) {
    if (err instanceof OracleError) {
      return bad(400, "malformed_check_request", { reason: (err as Error).message });
    }
    if ((err as { name?: string }).name === "ToolInputError") {
      return bad(400, (err as { code: string }).code);
    }
    throw err; // unexpected → fail closed
  }

  const usage = await checkMonthlyUsage(`tools:attest-exactness:${payer.payer_id}`, 0);

  const input_hash =
    "sha256:" +
    createHash("sha256")
      .update(canonicalInputBytes("attest-exactness", outcome.detail.artifact_hash as string))
      .digest("hex");
  const receipt_id = newReceiptId();
  const receiptPayload = buildToolReceiptPayload({
    tool: "attest-exactness",
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

  await meterToolUse("attest-exactness", PRICE_UUSDC, receipt_id);

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_UUSDC / 1_000_000,
      price_label: TOOL_PRICE_LABELS["attest-exactness"],
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
