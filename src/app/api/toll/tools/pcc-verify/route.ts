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
  validatePccVerify,
  runPccVerify,
  ToolDependencyError,
  ToolInputError,
} from "@/lib/toll-tools-wave1.mjs";

/**
 * POST /api/toll/tools/pcc-verify { blob_base64, orig_size, expected_sha256 }
 * Decodes a PCC blob with `savant_codec2 decode <in> <origsize> <out>`,
 * SHA-256s the output, and compares it to expected_sha256.
 * Match → result "pass"; mismatch → result "refuse" (signed receipt
 * either way). Blob cap 8MB, decode timeout 60s.
 *
 * Price: flat 20,000 µUSDC ($0.02) per verification.
 * Flag TOLL_TOOLS_LIVE default OFF → 503.
 */

const PRICE_UUSDC = TOOL_PRICE_UUSDC_FLAT["pcc-verify"] ?? 20_000;

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
    return sandboxTool(req, "pcc-verify", validatePccVerify as (body: unknown) => ToolValidateResult);
  }

  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  const body = await req.json().catch(() => null);
  const v = validatePccVerify(body);
  if (v.ok === false) {
    return bad(400, v.code, { reason: v.reason });
  }
  const input = v.value;

  let outcome;
  try {
    outcome = await runPccVerify(input);
  } catch (err) {
    if ((err as { name?: string }).name === "ToolDependencyError") {
      const e = err as { code: string; status: number };
      return bad(e.status, e.code, { tool: "pcc-verify" });
    }
    if ((err as { name?: string }).name === "ToolInputError") {
      return bad(400, (err as { code: string }).code);
    }
    throw err; // unexpected → fail closed
  }

  const usage = await checkMonthlyUsage(`tools:pcc-verify:${payer.payer_id}`, 0);

  const input_hash =
    "sha256:" +
    createHash("sha256")
      .update(canonicalInputBytes("pcc-verify", `${input.orig_size}:${input.expected_sha256}:${createHash("sha256").update(input.decoded).digest("hex")}`))
      .digest("hex");
  const receipt_id = newReceiptId();
  const receiptPayload = buildToolReceiptPayload({
    tool: "pcc-verify",
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

  await meterToolUse("pcc-verify", PRICE_UUSDC, receipt_id);

  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: PRICE_UUSDC / 1_000_000,
      price_label: TOOL_PRICE_LABELS["pcc-verify"],
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
