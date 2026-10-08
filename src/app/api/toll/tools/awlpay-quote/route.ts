import { NextRequest, NextResponse } from "next/server";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxTool, type ToolValidateResult } from "@/lib/toll-sandbox";
import { signTollPayload } from "@/lib/toll-receipt";
import {
  TOOL_CORS_HEADERS,
  TOLL_TOOLS_OFF_BODY,
  TOOL_PRICE_UUSDC_FLAT,
  buildToolReceiptPayload,
  isTollToolsLive,
  meterToolUse,
} from "@/lib/toll-tools";
import { runAwlpayQuote, validateAwlpayQuote } from "@/lib/toll-tools-wave3.mjs";

/**
 * Tool — cross-rail payment quote ($0.005 per quote, 5,000 µUSDC).
 * POST /api/toll/tools/awlpay-quote { amount_uusdc, rail }
 * → pure integer math, no dependencies: fee_uusdc = ceil(amount * 0.5%)
 * computed WITHOUT floats as floor((amount*5 + 999) / 1000); net_uusdc =
 * amount_uusdc - fee_uusdc. Only fails on bad input (400).
 * Flag TOLL_TOOLS_LIVE default OFF → 503 (no state).
 */

const TOOL = "awlpay-quote" as const;

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
  // no meter, no side effects.
  if (isSandboxRequest(req)) {
    return sandboxTool(req, TOOL, (body: unknown): ToolValidateResult => {
      const v = validateAwlpayQuote(body);
      return v.ok
        ? { ok: true, detail: { amount_uusdc: v.value.amount_uusdc, rail: v.value.rail } }
        : { ok: false, code: v.code, reason: v.reason };
    });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validateAwlpayQuote(body);
  if (!v.ok) return bad(400, v.code, { reason: v.reason });

  // Pure integer math — no dependencies, cannot fail closed.
  const out = runAwlpayQuote(v.value);

  const price_uusdc = TOOL_PRICE_UUSDC_FLAT[TOOL] ?? 5_000;
  const usage = await checkMonthlyUsage(`tools:${TOOL}:${payer.payer_id}`, 0);

  const payload = buildToolReceiptPayload({
    tool: TOOL,
    payer_id: payer.payer_id,
    price_uusdc,
    result: out.result === "refuse" ? "refuse" : "pass",
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
      result: out.result === "refuse" ? "refuse" : "pass",
      detail: out.detail,
    },
    { headers: TOOL_CORS_HEADERS }
  );
}
