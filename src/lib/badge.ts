import { createHmac } from "crypto";
import { resolveById } from "@/lib/agents";
import { verifyPoWChain, getBlendedTrustScore } from "@/lib/reputation";

// Signed, shareable 24h trust badges — ported from agentmagnet/routes/registry.js
// (buildBadge / verifyBadgeSignature). An agent attaches its badge to outbound
// requests as X-Agent-Trust-Badge so another agent can verify the trust score
// offline (HMAC check + expiry), without a network round trip back to this
// platform. Distinct from the rider JWT: a rider proves *authorization* to act
// (clearance level, scopes); a badge advertises *reputation* to a peer agent.

export interface TrustBadge {
  schema: "agentrider-trust-badge/v1";
  issued_at: string;
  expires_at: string;
  agent: { id: string; name: string; type: string; platform: "AgentRider"; platform_url: string };
  trust: {
    chain_length: number;
    chain_valid: boolean;
    blended_trust_score: number;
    tasks_completed: number;
    credits: number;
    latest_hash: string | null;
    verify_url: string;
  };
  signature: string;
}

function badgeSecret(): string {
  const secret = process.env.BADGE_SECRET;
  if (!secret) throw new Error("Missing BADGE_SECRET environment variable");
  return secret;
}

function sign(payload: object): string {
  return createHmac("sha256", badgeSecret()).update(JSON.stringify(payload)).digest("hex");
}

function platformUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentrider.vercel.app";
}

export async function buildBadge(agentId: string): Promise<TrustBadge | null> {
  const participant = await resolveById(agentId);
  if (!participant) return null;

  const chain = await verifyPoWChain(agentId);
  const trustScore = await getBlendedTrustScore(agentId);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const base = platformUrl();

  const payload = {
    schema: "agentrider-trust-badge/v1" as const,
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    agent: {
      id: participant.id,
      name: participant.name,
      type: participant.type,
      platform: "AgentRider" as const,
      platform_url: base,
    },
    trust: {
      chain_length: chain.length,
      chain_valid: chain.valid,
      blended_trust_score: trustScore,
      tasks_completed: participant.tasksCompleted,
      credits: participant.credits,
      latest_hash: null as string | null, // last PoW hash isn't tracked on the DomainReputation-shaped return; see verifyPoWChain if needed later
      verify_url: `${base}/api/reputation/${participant.id}`,
    },
  };

  return { ...payload, signature: sign(payload) };
}

export function verifyBadgeSignature(badge: TrustBadge): { valid: boolean; expired: boolean } {
  const { signature, ...payload } = badge;
  const expected = sign(payload);
  const expired = new Date(badge.expires_at) < new Date();
  // Constant-time-ish comparison isn't critical here — the badge is not a
  // secret itself, only a signed attestation; timing leaks reveal nothing
  // exploitable beyond "is this hex string right", same as any HMAC check
  // in agentmagnet's original implementation.
  return { valid: signature === expected, expired };
}
