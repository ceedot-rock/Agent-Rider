import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkMonthlyUsage } from "@/lib/rate-limit";
import { isTollPayerOk, resolveTollPayer } from "@/lib/toll-billing";
import { isSandboxRequest, sandboxTool } from "@/lib/toll-sandbox";
import { signTollPayload } from "@/lib/toll-receipt";
import {
  buildToolReceiptPayload,
  isTollToolsLive,
  meterToolUse,
  TOOL_CORS_HEADERS,
  TOOL_PRICE_LABELS,
  TOOL_PRICE_UUSDC_FLAT,
  TOLL_TOOLS_OFF_BODY,
} from "@/lib/toll-tools";
import {
  canonicalJson,
  drawDetailOf,
  ExactOddsUpstreamError,
  runExactoddsDraw,
  sha256Hex,
  UPSTREAM_TIMEOUT_MS,
  validateExactoddsDraw,
} from "@/lib/toll-tools-wave2.mjs";

/**
 * Toll Tool — exactodds-draw ($0.01 per draw, 10,000 µUSDC).
 * POST /api/toll/tools/exactodds-draw { game_id, draw_id?, count? }
 * → provably-fair draw via the real ExactOdds upstream
 *   (https://exactodds-api.fly.dev, POST /v1/<program>/<function>).
 * game_id selects a fixed upstream draw function; integer seeds are derived
 * deterministically from (game_id, draw_id) via sha256, so draw_id is a real
 * idempotency key: same inputs replay the same upstream call. Fail closed on
 * any upstream failure. Flag TOLL_TOOLS_LIVE default OFF → 503.
 */

const TOOL = "exactodds-draw" as const;
const PRICE_UUSDC: number = TOOL_PRICE_UUSDC_FLAT[TOOL] ?? 10_000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: TOOL_CORS_HEADERS });
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: TOOL_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // 1. Master flag.
  if (!isTollToolsLive()) {
    return NextResponse.json(TOLL_TOOLS_OFF_BODY, { status: 503, headers: TOOL_CORS_HEADERS });
  }

  // 2. Corruption sandbox: validates input shape only, never touches upstream.
  if (isSandboxRequest(req)) {
    return sandboxTool(req, TOOL, validateExactoddsDraw);
  }

  // 3. Caller pays.
  const payer = await resolveTollPayer(req);
  if (!isTollPayerOk(payer)) {
    return NextResponse.json(payer.body, { status: payer.status, headers: TOOL_CORS_HEADERS });
  }

  // 4. Validate input → 400 named codes.
  const body = await req.json().catch(() => null);
  const v = validateExactoddsDraw(body);
  if (v.ok === false) {
    return bad(400, v.code, v.reason ? { reason: v.reason } : undefined);
  }

  // 5. Upstream draw (15s timeout). Dependency errors → named 503s;
  //    anything unexpected throws (fail closed).
  let out;
  try {
    out = await runExactoddsDraw(v.value, { timeoutMs: UPSTREAM_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ExactOddsUpstreamError) {
      return bad(err.status, err.code, { reason: err.message });
    }
    throw err;
  }

  // 6. Monthly usage. No Stripe reporting; billed:false.
  const usage = await checkMonthlyUsage(`tools:${TOOL}:${payer.payer_id}`, 0);

  // 7. Receipt payload.
  const input_hash = "sha256:" + sha256Hex(canonicalJson(v.value));
  const detail = drawDetailOf(out);
  const payload = buildToolReceiptPayload({
    tool: TOOL,
    payer_id: payer.payer_id,
    price_uusdc: PRICE_UUSDC,
    result: "pass",
    input_hash,
    detail,
  });

  // 8. Sign — fail closed without the toll signing key.
  let envelope;
  try {
    envelope = signTollPayload(payload);
  } catch {
    return bad(500, "signing_unavailable");
  }

  const receipt_id = `tool_${createHash("sha256")
    .update(JSON.stringify(envelope), "utf8")
    .digest("hex")
    .slice(0, 16)}`;

  // 9. Meter — fail-open, never blocks the result.
  await meterToolUse(TOOL, PRICE_UUSDC, receipt_id);

  // 10. Response.
  return NextResponse.json(
    {
      live: true,
      metered: true,
      price_usd: TOOL_PRICE_LABELS[TOOL],
      receipt_id,
      envelope,
      usage: {
        callsThisMonth: usage.count,
        freeLimit: 0,
        overage: usage.overLimit,
        billed: false,
      },
      payer: { kind: payer.kind, payer_id: payer.payer_id },
      draw_id: out.draw_id,
      game_id: out.game_id,
      program: out.program,
      function: out.function,
      count: out.count,
      results: out.results,
      results_sha256: out.results_sha256,
      source_hash: out.source_hash,
    },
    { headers: TOOL_CORS_HEADERS }
  );
}
