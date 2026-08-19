import { NextRequest } from "next/server";
import { checkGateForToken, isGateOk } from "@/lib/rider";
import { resolveByApiKey, resolveById, type Participant } from "@/lib/agents";

export type CallerOk = { ok: true; participant: Participant };
export type CallerFail = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

function extractBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Resolve the calling participant from either a rider (X-Agent-Rider)
 * or the one-time api_key (Authorization: Bearer ar_…). Self-service
 * pages use the api_key because riders expire in 15 minutes.
 */
export async function resolveCaller(req: NextRequest | Request): Promise<CallerOk | CallerFail> {
  const riderToken = req.headers.get("x-agent-rider");
  if (riderToken) {
    const gate = await checkGateForToken(riderToken, "L0");
    if (!isGateOk(gate)) {
      return { ok: false, status: gate.status, body: gate.body, headers: gate.headers };
    }
    const participant = await resolveById(gate.rider.agent_id);
    if (!participant) {
      return { ok: false, status: 401, body: { error: "unknown_agent" } };
    }
    return { ok: true, participant };
  }

  const apiKey = extractBearer(req);
  if (apiKey) {
    const participant = await resolveByApiKey(apiKey);
    if (!participant) {
      return { ok: false, status: 401, body: { error: "invalid_api_key" } };
    }
    return { ok: true, participant };
  }

  return {
    ok: false,
    status: 401,
    body: {
      error: "missing_auth",
      hint: "send X-Agent-Rider or Authorization: Bearer <api_key> from POST /api/start",
      start_url: "/start",
    },
  };
}
