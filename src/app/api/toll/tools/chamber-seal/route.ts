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
import {
  ToolRunError,
  runChamberSeal,
  validateChamberSeal,
} from "@/lib/toll-tools-wave3.mjs";

/**
 * Tool — Chamber-sealed envelope ($0.02 per seal, 20,000 µUSDC).
 * POST /api/toll/tools/chamber-seal { payload: object }
 * → seals sha256(canonical JSON of payload) in a Chamber envelope signed
 * with CHAMBER_SIGNING_KEY (ES256 P-256 PKCS8 PEM). The envelope is
 * returned AND wrapped in the standard toll receipt (detail.chamber_envelope).
 *
 * FAILS CLOSED: without CHAMBER_SIGNING_KEY installed this tool returns
 * 503 chamber_key_unavailable — expected in production until Corey
 * approves installing the chamber key as a Fly secret. It never fakes
 * a seal. Key material is never logged.
 * Flag TOLL_TOOLS_LIVE default OFF → 503 (no state).
 */

const TOOL = "chamber-seal" as const;

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
  // no meter, no key access, no side effects.
  if (isSandboxRequest(req)) {
    return sandboxTool(req, TOOL, (body: unknown): ToolValidateResult => {
      const v = validateChamberSeal(body);
      return v.ok
        ? { ok: true, detail: {} }
        : { ok: false, code: v.code, reason: v.reason };
    });
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validateChamberSeal(body);
  if (!v.ok) return bad(400, v.code, { reason: v.reason });

  let out;
  try {
    out = await runChamberSeal(v.value);
  } catch (err) {
    if (err instanceof ToolRunError) return bad(err.status, err.code, { reason: (err as Error).message });
    throw err;
  }

  const price_uusdc = TOOL_PRICE_UUSDC_FLAT[TOOL] ?? 20_000;
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
      chamber_envelope: out.chamber_envelope,
      detail: out.detail,
    },
    { headers: TOOL_CORS_HEADERS }
  );
}
