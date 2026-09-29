/**
 * Toll 2 — verified-capability store.
 * Pure validation/filter lives in capabilities-core.mjs (selftest-importable).
 * Free listing (upsert/get). Metered lookup: /api/toll/v2/lookup.
 */

import { createHash, randomBytes } from "crypto";
import { getDB } from "@/lib/db";
import {
  EVIDENCE_LEVELS as EVIDENCE_LEVELS_JS,
  EVIDENCE_KINDS as EVIDENCE_KINDS_JS,
  VERIFIED_EVIDENCE_LEVELS as VERIFIED_EVIDENCE_LEVELS_JS,
  EVIDENCE_LEVEL_WEIGHT as EVIDENCE_LEVEL_WEIGHT_JS,
  defaultLevelForKind as defaultLevelForKindJs,
  isVerifiedEvidenceLevel as isVerifiedEvidenceLevelJs,
  honestyForLevel as honestyForLevelJs,
  validateCapabilityUpsert as validateCapabilityUpsertJs,
  rankScore as rankScoreJs,
  filterAndRankCapabilities as filterAndRankCapabilitiesJs,
} from "./capabilities-core.mjs";

export const EVIDENCE_LEVELS = EVIDENCE_LEVELS_JS as readonly [
  "L0_self",
  "L1_receipt",
  "L2_exactness",
  "L3_attest",
];
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_KINDS = EVIDENCE_KINDS_JS as readonly [
  "self_asserted",
  "rider_receipt",
  "cuni_exactness",
  "host_attest",
];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const VERIFIED_EVIDENCE_LEVELS = VERIFIED_EVIDENCE_LEVELS_JS as ReadonlySet<EvidenceLevel>;
export const EVIDENCE_LEVEL_WEIGHT = EVIDENCE_LEVEL_WEIGHT_JS as Record<EvidenceLevel, number>;

export type CapabilityInterface =
  | { kind: "mcp"; url: string; tools?: string[] }
  | { kind: "http"; method: string; url: string }
  | { kind: string; url?: string; method?: string; tools?: string[]; [k: string]: unknown };

export interface CapabilityEvidence {
  kind: EvidenceKind;
  refs?: string[];
  verified_at?: string | null;
  expires_at?: string | null;
}

export interface CapabilityTrust {
  agent_trust_score?: number | null;
  evidence_level: EvidenceLevel;
}

export interface CapabilityPlacement {
  promoted: boolean;
  promoted_until: string | null;
}

export interface CapabilityHonesty {
  live: boolean;
  parked_note: string | null;
}

export interface Capability {
  capability_id: string;
  agent_id: string;
  name: string;
  summary: string;
  tags: string[];
  interfaces: CapabilityInterface[];
  evidence: CapabilityEvidence;
  trust: CapabilityTrust;
  placement: CapabilityPlacement;
  honesty: CapabilityHonesty;
  created_at?: string;
  updated_at?: string;
}

export interface CapabilityUpsertInput {
  capability_id?: string;
  agent_id: string;
  name: string;
  summary?: string;
  tags?: string[];
  interfaces?: CapabilityInterface[];
  evidence?: Partial<CapabilityEvidence>;
  trust?: Partial<CapabilityTrust>;
  honesty?: Partial<CapabilityHonesty>;
}

export type ValidateOk = { ok: true; value: CapabilityUpsertInput };
export type ValidateFail = { ok: false; error: string; detail?: string };

export function defaultLevelForKind(kind: EvidenceKind): EvidenceLevel {
  return defaultLevelForKindJs(kind) as EvidenceLevel;
}

export function isVerifiedEvidenceLevel(level: EvidenceLevel): boolean {
  return isVerifiedEvidenceLevelJs(level);
}

export function honestyForLevel(level: EvidenceLevel): CapabilityHonesty {
  return honestyForLevelJs(level) as CapabilityHonesty;
}

export function validateCapabilityUpsert(body: unknown): ValidateOk | ValidateFail {
  return validateCapabilityUpsertJs(body) as ValidateOk | ValidateFail;
}

export function rankScore(cap: Capability): number {
  return rankScoreJs(cap);
}

export interface LookupQuery {
  query?: string;
  tags?: string[];
  min_evidence?: EvidenceLevel;
  limit?: number;
  verified_only?: boolean;
}

export interface LookupMatch {
  capability_id: string;
  agent_id: string;
  name: string;
  summary: string;
  tags: string[];
  interfaces: CapabilityInterface[];
  evidence_level: EvidenceLevel;
  verified: boolean;
  score: number;
  promoted: boolean;
  honesty: CapabilityHonesty;
}

export function filterAndRankCapabilities(
  caps: Capability[],
  query: LookupQuery
): LookupMatch[] {
  return filterAndRankCapabilitiesJs(caps, query) as LookupMatch[];
}

function newCapabilityId(agentId: string, name: string): string {
  const h = createHash("sha256")
    .update(`${agentId}:${name}:${randomBytes(8).toString("hex")}`)
    .digest("hex");
  return `cap_${h.slice(0, 24)}`;
}

interface CapabilityRow {
  capability_id: string;
  agent_id: string;
  name: string;
  summary: string;
  tags: string[];
  interfaces: CapabilityInterface[];
  evidence: CapabilityEvidence;
  trust: CapabilityTrust;
  placement: CapabilityPlacement;
  honesty: CapabilityHonesty;
  created_at: string;
  updated_at: string;
}

function rowToCapability(row: CapabilityRow): Capability {
  return {
    capability_id: row.capability_id,
    agent_id: row.agent_id,
    name: row.name,
    summary: row.summary ?? "",
    tags: row.tags ?? [],
    interfaces: row.interfaces ?? [],
    evidence: row.evidence,
    trust: row.trust,
    placement: row.placement ?? { promoted: false, promoted_until: null },
    honesty: row.honesty ?? honestyForLevel(row.trust?.evidence_level ?? "L0_self"),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const memStore = new Map<string, CapabilityRow>();

function memUpsert(row: CapabilityRow): CapabilityRow {
  memStore.set(row.capability_id, row);
  return row;
}

export async function upsertCapability(
  input: CapabilityUpsertInput,
  opts?: { existingId?: string }
): Promise<{ capability: Capability; store: "supabase" | "memory"; dbError?: string }> {
  const now = new Date().toISOString();
  const capability_id =
    opts?.existingId || input.capability_id || newCapabilityId(input.agent_id, input.name);

  const evidence = {
    kind: (input.evidence?.kind ?? "self_asserted") as EvidenceKind,
    refs: input.evidence?.refs ?? [],
    verified_at: input.evidence?.verified_at ?? null,
    expires_at: input.evidence?.expires_at ?? null,
  };
  const evidence_level =
    (input.trust?.evidence_level as EvidenceLevel | undefined) ??
    defaultLevelForKind(evidence.kind);
  const trust: CapabilityTrust = {
    agent_trust_score: input.trust?.agent_trust_score ?? null,
    evidence_level,
  };
  const honesty: CapabilityHonesty = input.honesty
    ? {
        live: input.honesty.live ?? honestyForLevel(evidence_level).live,
        parked_note:
          input.honesty.parked_note !== undefined
            ? input.honesty.parked_note
            : honestyForLevel(evidence_level).parked_note,
      }
    : honestyForLevel(evidence_level);
  const placement: CapabilityPlacement = { promoted: false, promoted_until: null };

  const existingMem = memStore.get(capability_id);
  const row: CapabilityRow = {
    capability_id,
    agent_id: input.agent_id,
    name: input.name,
    summary: input.summary ?? "",
    tags: input.tags ?? [],
    interfaces: input.interfaces ?? [],
    evidence,
    trust,
    placement: existingMem?.placement ?? placement,
    honesty,
    created_at: existingMem?.created_at ?? now,
    updated_at: now,
  };

  try {
    const db = getDB();
    const { data: existing } = await db
      .from("capabilities")
      .select("capability_id, placement, created_at")
      .eq("capability_id", capability_id)
      .maybeSingle();

    const payload = {
      capability_id,
      agent_id: row.agent_id,
      name: row.name,
      summary: row.summary,
      tags: row.tags,
      interfaces: row.interfaces,
      evidence: row.evidence,
      trust: row.trust,
      placement: existing?.placement ?? placement,
      honesty: row.honesty,
      updated_at: now,
      ...(existing ? {} : { created_at: now }),
    };

    const { data, error } = await db
      .from("capabilities")
      .upsert(payload, { onConflict: "capability_id" })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return { capability: rowToCapability(data as CapabilityRow), store: "supabase" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const saved = memUpsert(row);
    return {
      capability: rowToCapability(saved),
      store: "memory",
      dbError: msg.slice(0, 240),
    };
  }
}

export async function getCapability(capabilityId: string): Promise<Capability | null> {
  try {
    const db = getDB();
    const { data, error } = await db
      .from("capabilities")
      .select("*")
      .eq("capability_id", capabilityId)
      .maybeSingle();
    if (!error && data) return rowToCapability(data as CapabilityRow);
  } catch {
    /* fall through */
  }
  const mem = memStore.get(capabilityId);
  return mem ? rowToCapability(mem) : null;
}

export async function listCapabilitiesForLookup(): Promise<Capability[]> {
  try {
    const db = getDB();
    const { data, error } = await db.from("capabilities").select("*").limit(500);
    if (!error && Array.isArray(data)) {
      return data.map((r) => rowToCapability(r as CapabilityRow));
    }
  } catch {
    /* fall through */
  }
  return Array.from(memStore.values()).map(rowToCapability);
}

export function _resetCapabilityMemStoreForTests(): void {
  memStore.clear();
}

/**
 * Toll 2 promote fulfillment — flips a capability's placement.
 * Called from the Stripe webhook when a toll2_promote subscription starts
 * (promoted=true until period end) or is deleted (promoted=false).
 * Updates Supabase when reachable, else the in-memory store.
 */
export async function setCapabilityPromotion(
  capabilityId: string,
  promoted: boolean,
  promotedUntil: string | null
): Promise<{ ok: boolean; store: "supabase" | "memory"; dbError?: string }> {
  const placement: CapabilityPlacement = { promoted, promoted_until: promotedUntil };
  const now = new Date().toISOString();
  try {
    const db = getDB();
    const { error } = await db
      .from("capabilities")
      .update({ placement, updated_at: now })
      .eq("capability_id", capabilityId);
    if (error) throw new Error(error.message);
    const mem = memStore.get(capabilityId);
    if (mem) memStore.set(capabilityId, { ...mem, placement, updated_at: now });
    return { ok: true, store: "supabase" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const mem = memStore.get(capabilityId);
    if (mem) memStore.set(capabilityId, { ...mem, placement, updated_at: now });
    return { ok: !!mem, store: "memory", dbError: msg.slice(0, 240) };
  }
}
