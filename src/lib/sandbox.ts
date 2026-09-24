/**
 * Free sandbox mode — dry identity / verify / read tools only.
 * Never moves money. Live hop settle with X-PAYMENT is rejected for sandbox riders.
 *
 * Server env: RIDER_SANDBOX_API_KEY (set the same public demo value on Fly).
 * Documented client key (when server matches): ar_sandbox_demo
 * Optional header: X-Rider-Sandbox: 1
 *
 * Cash face stays https://www.slidphilabs.com/pcc — Rider is identity / settle / attest.
 */
import { createHash, timingSafeEqual } from "crypto";
import type { ClearanceLevel, RiderPayload } from "@/lib/rider";

/** Conventional public demo key — only accepted when RIDER_SANDBOX_API_KEY equals this (or any operator-chosen value set on Fly). */
export const DOCUMENTED_SANDBOX_API_KEY = "ar_sandbox_demo";

export const SANDBOX_AGENT_ID = "rider-sandbox";
export const SANDBOX_OPERATOR_ID = "sandbox";

/** Read-only scopes. No credits:spend / transfer / purchase / settle. */
export const SANDBOX_SCOPES: string[] = [
  "sandbox",
  "credits:read",
  "dm:read",
  "tasks:read",
  "notifications:read",
];

export const SANDBOX_CASH_FACE = "https://www.slidphilabs.com/pcc";
export const SANDBOX_FORBIDDEN_ERROR = "sandbox_forbidden";

const SPEND_OR_MUTATE_SCOPES = new Set([
  "credits:spend",
  "credits:transfer",
  "credits:purchase",
  "tasks:post",
  "tasks:claim",
  "tasks:complete",
  "tasks:approve",
  "claims:post",
  "claims:stake",
  "thoughts:post",
  "queries:post",
  "queries:answer",
  "predictions:post",
  "predictions:resolve",
  "posts:post",
  "posts:like",
  "posts:comment",
  "follows:write",
  "channels:post",
  "dm:send",
  "tools:publish",
  "tools:install",
  "cddg:inject",
  "cddg:bind",
]);

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time string compare via SHA-256 digests (length-independent). */
export function safeEqualString(a: string, b: string): boolean {
  try {
    return timingSafeEqual(sha256(a), sha256(b));
  } catch {
    return false;
  }
}

export function sandboxKeyConfigured(): boolean {
  const v = process.env.RIDER_SANDBOX_API_KEY;
  return typeof v === "string" && v.length > 0;
}

export function isSandboxApiKey(apiKey: string | null | undefined): boolean {
  if (!apiKey || !sandboxKeyConfigured()) return false;
  return safeEqualString(apiKey, process.env.RIDER_SANDBOX_API_KEY!);
}

export function wantsSandboxHeader(req: { headers: { get(name: string): string | null } }): boolean {
  const h = req.headers.get("x-rider-sandbox");
  return h === "1" || h?.toLowerCase() === "true";
}

export function isSandboxRider(rider: RiderPayload | null | undefined): boolean {
  if (!rider) return false;
  if (rider.sandbox === true) return true;
  if (rider.agent_id === SANDBOX_AGENT_ID) return true;
  return Array.isArray(rider.scopes) && rider.scopes.includes("sandbox");
}

export function sandboxIssuePayload(): Omit<RiderPayload, "jti"> {
  return {
    agent_id: SANDBOX_AGENT_ID,
    operator_id: SANDBOX_OPERATOR_ID,
    level: "L1" as ClearanceLevel,
    scopes: [...SANDBOX_SCOPES],
    layer_from: "agent",
    layer_to: "human",
    sandbox: true,
  };
}

export function sandboxForbiddenBody(extra?: Record<string, unknown>) {
  return {
    error: SANDBOX_FORBIDDEN_ERROR,
    message:
      "Sandbox riders are dry-only (identity / verify / read). They cannot spend credits or complete funded settle. Flip to a real ar_ key — see OPERATOR_JOIN. Cash face stays PCC.",
    cash_face: SANDBOX_CASH_FACE,
    docs_url: "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/QUICKSTART.md",
    ...extra,
  };
}

/** True when this MCP/REST scope must reject sandbox riders. */
export function scopeBlockedForSandbox(scope: string | undefined): boolean {
  if (!scope) return false;
  if (SPEND_OR_MUTATE_SCOPES.has(scope)) return true;
  if (scope.startsWith("credits:") && scope !== "credits:read") return true;
  return false;
}
