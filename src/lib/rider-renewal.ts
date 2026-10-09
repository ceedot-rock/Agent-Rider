/**
 * Rider renewal tokens — automatic, secure renewal for the fixed 15-minute rider.
 *
 * Riders stay 15 minutes, always. There is no expiry knob on this path, by
 * design: a short rider bounds the revocation window, and renewal tokens
 * (OAuth2 refresh-token style) give agents the "set it and forget it" UX
 * without weakening it.
 *
 * Model:
 * - On rider issue, the server also mints an opaque renewal token
 *   (`rrt_` + 192 bits). Only its SHA-256 hash is stored — never the token.
 * - POST /api/rider/renew exchanges a renewal token for a fresh 15m rider.
 * - Rotation: every successful renew burns the presented token (status=used)
 *   and issues a new one on the same chain_id.
 * - Reuse detection: presenting an already-rotated token is treated as
 *   compromise — every renewal chain for that agent_id is revoked and the
 *   event is logged (hashes/ids only, never token values).
 * - Revocation: POST /api/rider/renew/revoke kills a token's whole chain.
 *   Outstanding riders die at their own 15m expiry; revocation only stops
 *   future renewals.
 *
 * Storage follows the agents.ts dual-backend pattern: Postgres table
 * `rider_renewal_tokens` (see supabase/schema.sql) when Supabase creds exist,
 * else a disk JSON store (data/rider_renewal_tokens.json). The disk path is
 * what the selftests exercise.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDB } from "@/lib/db";
import { issueRider, type RiderPayload } from "@/lib/rider";

export const RENEWAL_TOKEN_PREFIX = "rrt_";
/** Default renewal-token lifetime: 30 days. Server-side env only (RIDER_RENEWAL_TTL_SECONDS) — never user-facing. */
export const DEFAULT_RENEWAL_TTL_SECONDS = 30 * 24 * 3600;
const TABLE = "rider_renewal_tokens";

export type RenewalStatus = "active" | "used" | "revoked";

export interface RenewalRow {
  token_hash: string;
  agent_id: string;
  chain_id: string;
  status: RenewalStatus;
  /** JSON of Omit<RiderPayload, "jti"> — the claims re-minted on every renew. */
  rider_claims: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export class RenewalError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = "RenewalError";
    this.code = code;
    this.status = status;
  }
}

/** Server-side only. Invalid values fall back to the 30-day default. */
export function renewalTtlSeconds(): number {
  const raw = process.env.RIDER_RENEWAL_TTL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_RENEWAL_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RENEWAL_TTL_SECONDS;
  return Math.floor(n);
}

/** The only form in which a renewal token ever touches storage or logs. */
export function hashRenewalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newTokenValue(): string {
  return RENEWAL_TOKEN_PREFIX + randomBytes(24).toString("hex");
}

function newChainId(): string {
  return randomBytes(16).toString("hex");
}

function diskPath(): string {
  return join(process.cwd(), "data", "rider_renewal_tokens.json");
}

function readDisk(): RenewalRow[] {
  const p = diskPath();
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(list) ? (list as RenewalRow[]) : [];
  } catch {
    return [];
  }
}

function writeDisk(list: RenewalRow[]): void {
  const p = diskPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(list, null, 2));
}

function usePostgres(): boolean {
  if (process.env.SELFTEST_DISK_ONLY === "1") return false;
  try {
    getDB();
    return true;
  } catch {
    return false;
  }
}

async function findRow(tokenHash: string): Promise<RenewalRow | null> {
  if (usePostgres()) {
    const { data } = await getDB().from(TABLE).select("*").eq("token_hash", tokenHash).single();
    return (data as RenewalRow | null) ?? null;
  }
  const want = Buffer.from(tokenHash, "utf8");
  for (const row of readDisk()) {
    try {
      if (timingSafeEqual(Buffer.from(row.token_hash, "utf8"), want)) return row;
    } catch {
      // length mismatch — not a match
    }
  }
  return null;
}

async function insertRow(row: RenewalRow): Promise<void> {
  if (usePostgres()) {
    const { error } = await getDB().from(TABLE).insert(row);
    if (error) throw new Error(`renewal store insert failed: ${error.message}`);
    return;
  }
  const list = readDisk();
  list.push(row);
  writeDisk(list);
}

/**
 * Single-use consume: marks the token `used` iff it is still `active`.
 * Returns the row on success, null if it was already consumed/revoked/missing.
 * The Postgres path is one atomic UPDATE … WHERE status='active'.
 */
async function consumeRow(tokenHash: string): Promise<RenewalRow | null> {
  const usedAt = new Date().toISOString();
  if (usePostgres()) {
    const { data } = await getDB()
      .from(TABLE)
      .update({ status: "used", used_at: usedAt })
      .eq("token_hash", tokenHash)
      .eq("status", "active")
      .select()
      .single();
    return (data as RenewalRow | null) ?? null;
  }
  const list = readDisk();
  const row = list.find((r) => r.token_hash === tokenHash && r.status === "active");
  if (!row) return null;
  row.status = "used";
  row.used_at = usedAt;
  writeDisk(list);
  return row;
}

/** Revoke every live token on one rotation chain. Returns rows revoked. */
export async function revokeRenewalChain(chainId: string, reason: string): Promise<number> {
  const revokedAt = new Date().toISOString();
  if (usePostgres()) {
    const { data, error } = await getDB()
      .from(TABLE)
      .update({ status: "revoked", revoked_at: revokedAt, revoke_reason: reason })
      .eq("chain_id", chainId)
      .in("status", ["active", "used"])
      .select("token_hash");
    if (error) throw new Error(`renewal chain revoke failed: ${error.message}`);
    return (data ?? []).length;
  }
  const list = readDisk();
  let n = 0;
  for (const r of list) {
    if (r.chain_id === chainId && (r.status === "active" || r.status === "used")) {
      r.status = "revoked";
      r.revoked_at = revokedAt;
      r.revoke_reason = reason;
      n++;
    }
  }
  writeDisk(list);
  return n;
}

/** Revoke every live renewal chain for an agent (reuse-detection response). */
export async function revokeAgentRenewalTokens(agentId: string, reason: string): Promise<number> {
  const revokedAt = new Date().toISOString();
  if (usePostgres()) {
    const { data, error } = await getDB()
      .from(TABLE)
      .update({ status: "revoked", revoked_at: revokedAt, revoke_reason: reason })
      .eq("agent_id", agentId)
      .in("status", ["active", "used"])
      .select("token_hash");
    if (error) throw new Error(`agent renewal revoke failed: ${error.message}`);
    return (data ?? []).length;
  }
  const list = readDisk();
  let n = 0;
  for (const r of list) {
    if (r.agent_id === agentId && (r.status === "active" || r.status === "used")) {
      r.status = "revoked";
      r.revoked_at = revokedAt;
      r.revoke_reason = reason;
      n++;
    }
  }
  writeDisk(list);
  return n;
}

/**
 * Mint a renewal token bound to an agent. The rider claims are stored alongside
 * so renew re-issues the *same* credential (level, scopes, operator) — a fresh
 * 15m window, not a fresh grant. Pass chainId to continue a rotation chain.
 */
export async function mintRenewalToken(
  agentId: string,
  claims: Omit<RiderPayload, "jti">,
  chainId?: string
): Promise<{ renewal_token: string; expires_in: number; chain_id: string }> {
  const token = newTokenValue();
  const ttl = renewalTtlSeconds();
  const now = Date.now();
  const cid = chainId ?? newChainId();
  await insertRow({
    token_hash: hashRenewalToken(token),
    agent_id: agentId,
    chain_id: cid,
    status: "active",
    rider_claims: JSON.stringify(claims),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 1000).toISOString(),
    used_at: null,
    revoked_at: null,
    revoke_reason: null,
  });
  return { renewal_token: token, expires_in: ttl, chain_id: cid };
}

/**
 * Best-effort wrapper for the /issue route: a renewal-store outage must never
 * break rider issuance itself. Returns null (and logs) instead of throwing.
 */
export async function tryMintRenewalToken(
  agentId: string,
  claims: Omit<RiderPayload, "jti">
): Promise<{ renewal_token: string; renewal_expires_in: number } | null> {
  try {
    const m = await mintRenewalToken(agentId, claims);
    return { renewal_token: m.renewal_token, renewal_expires_in: m.expires_in };
  } catch (err) {
    console.error("[rider-renewal] renewal mint failed; rider issued without renewal token", {
      agent_id: agentId,
    });
    return null;
  }
}

export interface RenewResult {
  rider: string;
  jti: string;
  /** Always 900 — riders stay 15 minutes fixed on this path. */
  expires_in: number;
  renewal_token: string;
  renewal_expires_in: number;
  agent_id: string;
}

/**
 * Exchange a renewal token for a fresh 15m rider, rotating the token.
 * requestedAgentId is optional; when supplied it must match the token's binding.
 */
export async function redeemRenewalToken(
  token: unknown,
  requestedAgentId?: string
): Promise<RenewResult> {
  if (typeof token !== "string" || token.length === 0) {
    throw new RenewalError("missing_renewal_token", 400);
  }
  const tokenHash = hashRenewalToken(token);
  const row = await findRow(tokenHash);
  if (!row) throw new RenewalError("invalid_renewal_token", 401);

  if (row.status === "used") {
    // Reuse of a rotated token = compromise signal: burn the agent's chains.
    // Outstanding riders are untouched — they die at their 15m expiry anyway.
    await revokeAgentRenewalTokens(row.agent_id, "reuse_detected");
    console.error("[rider-renewal] reuse detected — agent renewal chains revoked", {
      agent_id: row.agent_id,
      chain_id: row.chain_id,
    });
    throw new RenewalError(
      "token_reused",
      403,
      "renewal token already consumed — chain revoked as a compromise precaution"
    );
  }
  if (row.status === "revoked") throw new RenewalError("token_revoked", 403);
  if (Date.parse(row.expires_at) <= Date.now()) throw new RenewalError("token_expired", 403);
  if (requestedAgentId !== undefined && requestedAgentId !== row.agent_id) {
    throw new RenewalError("wrong_agent", 403);
  }

  const consumed = await consumeRow(tokenHash);
  if (!consumed) {
    // Lost a consume race — the token is now `used`, so treat the presenter
    // exactly like a reuse: conservative, per the theft-signal contract.
    await revokeAgentRenewalTokens(row.agent_id, "reuse_detected");
    console.error("[rider-renewal] concurrent reuse detected — agent renewal chains revoked", {
      agent_id: row.agent_id,
      chain_id: row.chain_id,
    });
    throw new RenewalError("token_reused", 403);
  }

  let claims: Omit<RiderPayload, "jti">;
  try {
    claims = JSON.parse(consumed.rider_claims) as Omit<RiderPayload, "jti">;
  } catch {
    throw new RenewalError("renew_failed", 500, "stored rider claims unreadable");
  }

  // Fixed 15m rider — issueRider's default; no expiry parameter exists here.
  const issued = await issueRider(claims);
  const next = await mintRenewalToken(consumed.agent_id, claims, consumed.chain_id);
  return {
    rider: issued.token,
    jti: issued.jti,
    expires_in: issued.expires_in,
    renewal_token: next.renewal_token,
    renewal_expires_in: next.expires_in,
    agent_id: consumed.agent_id,
  };
}

/** Holder revokes a renewal token's whole rotation chain. */
export async function revokeRenewalToken(
  token: unknown,
  reason = "holder_revoke"
): Promise<{ chain_id: string; agent_id: string }> {
  if (typeof token !== "string" || token.length === 0) {
    throw new RenewalError("missing_renewal_token", 400);
  }
  const row = await findRow(hashRenewalToken(token));
  if (!row) throw new RenewalError("invalid_renewal_token", 401);
  await revokeRenewalChain(row.chain_id, reason);
  return { chain_id: row.chain_id, agent_id: row.agent_id };
}
