/**
 * Toll Tools — the metered micro-tool shelf behind the toll gates.
 *
 * Ten tools, one trust model: every tool is toll-gated (caller pays via
 * ar_ key or merchant key), returns the standard signed toll-receipt
 * envelope on success AND on refuse, fails closed on any dependency
 * failure, and runs in the corruption sandbox under sk_sandbox_demo with
 * zero side effects.
 *
 * Routes live at /api/toll/tools/<name>. Flag: TOLL_TOOLS_LIVE (default
 * OFF → 503). Pricing is published machine-readable in /api/toll/schema.
 *
 * Signing: signTollPayload (dedicated TOLL_SIGNING_KEY — never the Rider
 * identity key; missing key throws → 500 fail-closed).
 * Metering: toll_meter rows (module "tools", operation <tool>) — fail-open
 * like the v5 gate; the tool result never depends on the meter write.
 */

import { getDB } from "@/lib/db";

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Master flag for the whole tool shelf. Default OFF. */
export function isTollToolsLive(): boolean {
  return envFlagOn("TOLL_TOOLS_LIVE");
}

export type ToolName =
  | "pcc-compress"
  | "pcc-verify"
  | "attest-notarize"
  | "attest-exactness"
  | "exactodds-draw"
  | "exactodds-resolve"
  | "cuni-proof"
  | "trustream-pack"
  | "chamber-seal"
  | "awlpay-quote";

export const TOOL_NAMES: ToolName[] = [
  "pcc-compress",
  "pcc-verify",
  "attest-notarize",
  "attest-exactness",
  "exactodds-draw",
  "exactodds-resolve",
  "cuni-proof",
  "trustream-pack",
  "chamber-seal",
  "awlpay-quote",
];

export const TOLL_TOOLS_OFF_BODY = {
  error: "toll_tools_off" as const,
  live: false as const,
  hint: "TOLL_TOOLS_LIVE is off (default). Set TOLL_TOOLS_LIVE=1 to enable the metered tool shelf.",
  metered_paths: TOOL_NAMES.map((t) => `/api/toll/tools/${t}`),
  schema_url: "/api/toll/schema",
};

/** 400 — caller sent a bad request. Named code, no receipt. */
export class ToolInputError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
  }
}

/**
 * 500/503 — a dependency the tool needs failed (binary missing, upstream
 * down, key absent, timeout). Fail closed: no receipt, no partial result.
 */
export class ToolDependencyError extends Error {
  code: string;
  status: 500 | 503;
  constructor(code: string, message: string, status: 500 | 503 = 500) {
    super(message);
    this.name = "ToolDependencyError";
    this.code = code;
    this.status = status;
  }
}

/** Human price labels, mirrored in /api/toll/schema. */
export const TOOL_PRICE_LABELS: Record<ToolName, string> = {
  "pcc-compress": "$0.01 per MB of input (10,000 µUSDC/MB, minimum 1,000 µUSDC)",
  "pcc-verify": "$0.02 per verification (20,000 µUSDC)",
  "attest-notarize": "$0.01 per notarization (10,000 µUSDC)",
  "attest-exactness": "$0.05 per check (50,000 µUSDC)",
  "exactodds-draw": "$0.01 per draw (10,000 µUSDC)",
  "exactodds-resolve": "$0.02 per resolution (20,000 µUSDC)",
  "cuni-proof": "$0.10 per proof (100,000 µUSDC)",
  "trustream-pack": "$0.01 per MB of input (10,000 µUSDC/MB, minimum 1,000 µUSDC)",
  "chamber-seal": "$0.02 per seal (20,000 µUSDC)",
  "awlpay-quote": "$0.005 per quote (5,000 µUSDC)",
};

/** Flat per-call prices in micro-USDC (integer; 1 USDC = 1,000,000). */
export const TOOL_PRICE_UUSDC_FLAT: Partial<Record<ToolName, number>> = {
  "pcc-verify": 20_000,
  "attest-notarize": 10_000,
  "attest-exactness": 50_000,
  "exactodds-draw": 10_000,
  "exactodds-resolve": 20_000,
  "cuni-proof": 100_000,
  "chamber-seal": 20_000,
  "awlpay-quote": 5_000,
};

/** Per-MB pricing for byte-metered tools. */
export function perMbUusdc(bytesIn: number): number {
  return Math.max(1_000, Math.ceil(bytesIn / 1_000_000) * 10_000);
}

/**
 * Record a meter row. Fail-open by design (matches the v5 gate): a meter
 * write failure is logged, never blocks the tool result. The signed
 * receipt is the control; metering is accounting.
 */
export async function meterToolUse(
  tool: ToolName,
  amount_uusdc: number,
  ref_id: string
): Promise<void> {
  try {
    const db = getDB();
    const row = await db.from("toll_meter").insert({
      module: "tools",
      operation: tool,
      amount_uusdc,
      ref_id,
      created_at: Math.floor(Date.now() / 1000),
    });
    if (row.error)
      console.error(`tools/${tool}: toll_meter write failed`, row.error.message);
  } catch (err) {
    console.error(
      `tools/${tool}: toll_meter write failed (fail-open)`,
      (err as Error).message
    );
  }
}

export interface ToolReceiptArgs {
  tool: ToolName;
  payer_id: string;
  price_uusdc: number;
  /** "pass" = the tool ran and produced its output; "refuse" = the tool ran and refused (negative outcome, still receipted). */
  result: "pass" | "refuse";
  /** sha256 of the canonical input, for auditability. */
  input_hash: string;
  /** Tool-specific result detail (sizes, hashes, verdicts — never secrets). */
  detail: Record<string, unknown>;
}

/** Standard signed tool-receipt payload. Sign with signTollPayload. */
export function buildToolReceiptPayload(args: ToolReceiptArgs): Record<string, unknown> {
  return {
    type: "tool-receipt",
    version: 1,
    tool: args.tool,
    issuer: "slid-phi-labs",
    issued_at: Math.floor(Date.now() / 1000),
    payer_id: args.payer_id,
    price_uusdc: args.price_uusdc,
    result: args.result,
    input_hash: args.input_hash,
    detail: args.detail,
  };
}

export const TOOL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Merchant-Key",
};

/** Binary locations inside the deployed image (overridable for tests). */
export function pccBin(): string {
  return process.env.PCC_BIN ?? "/app/pcc-bin/savant_codec2";
}
export function cuniBin(): string {
  return process.env.CUNI_BIN ?? "/app/cuni-bin/cuni";
}
export function trustreamPy(): string {
  return process.env.TRUSTREAM_PY ?? "/app/vendor/trustream.py";
}
