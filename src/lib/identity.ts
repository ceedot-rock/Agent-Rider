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

export function isCallerOk(result: CallerOk | CallerFail): result is CallerOk {
  return result.ok === true;
}

//
// Canonical agent identity (DM unification).
//
// Threads, rate limits, and notifications key on raw agent ids, so every
// remint splits history. agent_aliases maps each retired id to its canonical
// successor; every DM send/read follows the chain first.
//
// Pure core (followAliasChain) takes an injected lookup so it unit-tests
// without a database. resolveCanonicalId degrades to the input id when the
// DB is unreachable (disk-only selftest path) — no aliases visible offline
// is honest, not a failure.

import { getDB } from "@/lib/db";

const MAX_HOPS = 8;

export async function followAliasChain(
  startId: string,
  lookupAlias: (alias: string) => Promise<string | null> | string | null
): Promise<string> {
  let current = startId;
  const seen = new Set<string>([startId]);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = await lookupAlias(current);
    if (!next || next === current || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current;
}

async function dbLookup(alias: string): Promise<string | null> {
  const { data, error } = await getDB().from("agent_aliases").select("canonical_id").eq("alias", alias).maybeSingle();
  if (error || !data) return null;
  return (data as { canonical_id: string }).canonical_id;
}

export async function resolveCanonicalId(agentId: string): Promise<string> {
  try {
    return await followAliasChain(agentId, dbLookup);
  } catch {
    return agentId;
  }
}

/** Record a remint: oldId retires, newId is canonical from now on. */
export async function recordRemint(oldId: string, newId: string, note?: string): Promise<void> {
  if (!oldId || !newId || oldId === newId) throw new Error("bad_remint");
  const { error } = await getDB()
    .from("agent_aliases")
    .upsert({ alias: oldId, canonical_id: newId, note: note ?? null });
  if (error) throw new Error(`recordRemint: ${error.message}`);
}

