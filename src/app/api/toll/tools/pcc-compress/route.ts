import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import {
  TOOL_CORS_HEADERS,
  TOLL_TOOLS_OFF_BODY,
  TOOL_PRICE_LABELS,
  isTollToolsLive,
  meterToolUse,
  perMbUusdc,
  buildToolReceiptPayload,
} from "@/lib/toll-tools";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxTool, type ToolValidateResult } from "@/lib/toll-sandbox";
import { signTollPayload } from "@/lib/toll-receipt";
import {
  newReceiptId,
  canonicalInputBytes,
  validatePccCompress,
  runPccCompress,
  ToolDependencyError,
  ToolInputError,
} from "@/lib/toll-tools-wave1.mjs";

/**
 * POST /api/toll/tools/pcc-compress { data_base64 }
 * Metered PCC lossless compression. Full `savant_codec2 encode_whole`
 * bake-off on the input (cap 4MB decoded, 90s hard timeout — measured
 * 2026-10-08: ~3s for 100KB, ~48s median for 1MB adversarial random input
 * on the bundled binary; 4MB adversarial measured ~364s and would exceed
 * the kill — it fails closed 500 instead of hanging. Decode is cheap,
 * ~13ms for 46KB. The codec declines incompressible input by producing
 * no output file, which returns result "refuse" with a SIGNED receipt —
 * receipts cover refuse too, mirroring the v5 gate's negative-outcome
 * contract).
 *
 * Price: perMbUusdc(bytes_in) — $0.01/MB, minimum $0.001.
 * Flag TOLL_TOOLS_LIVE default OFF → 503.
 */

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
    return sandboxTool(req, "pcc-compress", validatePccCompress as (body: unknown) => ToolValidateResult);
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validatePccCompress(body);
  if (!v.ok) {
    return bad(400, v.code, { reason: v.reason });
  }
  const input = v.value;

  let outcome;
  try {
    outcome = await runPccCompress(input);
  } catch (err) {
    if (err instanceof ToolDependencyError || (err as { name?: string }).name === "ToolDependencyError") {
      const e = err as { code: string; status: number };
      return bad(e.status, e.code, { tool: "pcc-compress" });
    }
    if (err instanceof ToolInputError || (err as { name?: string }).name === "ToolInputError") {
      return bad(400, (err as { code: string }).code);
    }
    throw err; // unexpected → fail closed
  }

  const price_uusdc = perMbUusdc(input.decoded.length);
  const usage = await checkMonthlyUsage(`tools:pcc-compress:${payer.payer_id}`, 0);

  const input_hash = "sha256:" + createHash("sha256").update(canonicalInputBytes("pcc-compress", input.data_base64)).digest("hex");
  const receipt_id = newReceiptId();
  const receiptPayload = buildToolReceiptPayload({
    tool: "pcc-compress",
    payer_id: payer.payer_id,
    price_uusdc,
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

  await meterToolUse("pcc-compress", price_uusdc, receipt_id);

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: price_uusdc / 1_000_000,
      price_label: TOOL_PRICE_LABELS["pcc-compress"],
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
