import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxTool, type ToolValidateResult } from "@/lib/toll-sandbox";
import { signTollPayload } from "@/lib/toll-receipt";
import {
  TOOL_CORS_HEADERS,
  TOLL_TOOLS_OFF_BODY,
  buildToolReceiptPayload,
  isTollToolsLive,
  meterToolUse,
  perMbUusdc,
  trustreamPy,
} from "@/lib/toll-tools";
import {
  ToolRunError,
  runTristreamPack,
  validateTristreamPack,
} from "@/lib/toll-tools-wave3.mjs";

/**
 * Tool — TRUSTREAM stream packing ($0.01 per MB in, minimum $0.001).
 * POST /api/toll/tools/trustream-pack { data_base64 } (max 8MB decoded)
 * → packs via the vendored trustream.py library (python3 -c driver),
 * returns packed_base64 + a signed receipt with byte counts.
 * Flag TOLL_TOOLS_LIVE default OFF → 503 (no state).
 */

const TOOL = "trustream-pack" as const;

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

  // Corruption sandbox: demo key runs input validation only — no sign,
  // no meter, no subprocess, no side effects.
  if (isSandboxRequest(req)) {
    return sandboxTool(req, TOOL, (body: unknown): ToolValidateResult => {
      const v = validateTristreamPack(body);
      return v.ok
        ? { ok: true, detail: { bytes_in: v.value.data.length } }
        : { ok: false, code: v.code, reason: v.reason };
    });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validateTristreamPack(body);
  if (!v.ok) return bad(400, v.code, { reason: v.reason });

  let out;
  try {
    out = await runTristreamPack(v.value, { trustreamPyPath: trustreamPy() });
  } catch (err) {
    if (err instanceof ToolRunError) return bad(err.status, err.code, { reason: (err as Error).message });
    throw err;
  }

  const price_uusdc = perMbUusdc(out.detail.bytes_in);
  const usage = await checkMonthlyUsage(`tools:${TOOL}:${payer.payer_id}`, 0);

  const payload = buildToolReceiptPayload({
    tool: TOOL,
    payer_id: payer.payer_id,
    price_uusdc,
    result: out.result,
    input_hash: out.input_hash,
    detail: out.detail,
  });
  let envelope;
  try {
    envelope = signTollPayload(payload);
  } catch {
    return bad(500, "signing_unavailable");
  }

  const receipt_id = `t3_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  // Metering is fail-open by design; the signed receipt is the control.
  await meterToolUse(TOOL, price_uusdc, receipt_id);

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: price_uusdc / 1_000_000,
      receipt_id,
      envelope,
      usage: {
        checksThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: false,
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
      result: out.result,
      // The packed stream itself — response body only, never the receipt.
      packed_base64: out.packed.toString("base64"),
      detail: out.detail,
    },
    { headers: TOOL_CORS_HEADERS }
  );
}
