import { createHash, randomBytes } from "crypto";
import { getDB } from "@/lib/db";

export type ParticipantType = "agent" | "human";

export interface Participant {
  id: string;
  name: string;
  type: ParticipantType;
  operatorId: string | null;
  credits: number;
  tasksCompleted: number;
  referrals: number;
  referredBy: string | null;
  capabilities: string[];
  solanaWallet: string | null;
  registeredAt: string;
  lastActive: string;
}

interface ParticipantRow {
  id: string;
  api_key_hash: string | null;
  api_key_prefix: string | null;
  name: string;
  type: ParticipantType;
  operator_id: string | null;
  credits: string | number;
  tasks_completed: number;
  referrals: number;
  referred_by: string | null;
  capabilities: string[];
  solana_wallet: string | null;
  registered_at: string;
  last_active: string;
}

function rowToParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    operatorId: row.operator_id,
    credits: Number(row.credits),
    tasksCompleted: row.tasks_completed,
    referrals: row.referrals,
    referredBy: row.referred_by,
    capabilities: row.capabilities ?? [],
    solanaWallet: row.solana_wallet,
    registeredAt: row.registered_at,
    lastActive: row.last_active,
  };
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

// Decaying signup bonus (ported from agentmagnet/services/store.js) — first
// 100 registrations get 50 credits, next 500 get 20, everyone after gets 5.
// Front-loading rewards early adopters is deliberate anti-sybil design: a
// bot farm registering after the platform has traction gets a much smaller
// payout per fake account.
async function signupBonus(): Promise<number> {
  const db = getDB();
  const { count } = await db.from("participants").select("id", { count: "exact", head: true });
  const n = count ?? 0;
  if (n < 100) return 50;
  if (n < 600) return 20;
  return 5;
}

export interface RegisterInput {
  name: string;
  type: ParticipantType;
  operatorId?: string | null;
  referralCode?: string | null;
  capabilities?: string[];
}

export interface RegisterResult {
  participant: Participant;
  apiKey: string;
}

export async function registerParticipant(input: RegisterInput): Promise<RegisterResult> {
  const db = getDB();
  const id = randomBytes(8).toString("hex");
  const apiKey = "ar_" + randomBytes(20).toString("hex");
  const bonus = await signupBonus();

  let referrerId: string | null = null;
  if (input.referralCode) {
    const { data } = await db
      .from("participants")
      .select("id")
      .eq("api_key_hash", hashApiKey(input.referralCode))
      .single();
    referrerId = data?.id ?? null;
  }

  const credits = bonus + (referrerId ? 5 : 0);

  const { data: row, error } = await db
    .from("participants")
    .insert({
      id,
      api_key_hash: hashApiKey(apiKey),
      api_key_prefix: apiKey.slice(0, 12),
      name: input.name,
      type: input.type,
      operator_id: input.operatorId ?? null,
      credits,
      referred_by: referrerId,
      capabilities: input.capabilities ?? [],
    })
    .select()
    .single();

  if (error || !row) throw new Error(`registerParticipant: ${error?.message ?? "insert failed"}`);

  await recordTransaction(id, "signup_bonus", bonus, { referrerId });
  if (referrerId) await recordTransaction(id, "referral_join_bonus", 5, { referrerId });

  return { participant: rowToParticipant(row as ParticipantRow), apiKey };
}

export async function resolveByApiKey(apiKey: string): Promise<Participant | null> {
  const db = getDB();
  const { data } = await db
    .from("participants")
    .select("*")
    .eq("api_key_hash", hashApiKey(apiKey))
    .single();
  return data ? rowToParticipant(data as ParticipantRow) : null;
}

export async function resolveById(id: string): Promise<Participant | null> {
  const db = getDB();
  const { data } = await db.from("participants").select("*").eq("id", id).single();
  return data ? rowToParticipant(data as ParticipantRow) : null;
}

export async function recordTransaction(
  participantId: string,
  type: string,
  amount: number,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const db = getDB();
  const { data: participant } = await db
    .from("participants")
    .select("credits")
    .eq("id", participantId)
    .single();
  const balanceAfter = Number(participant?.credits ?? 0);

  await db.from("transactions").insert({
    participant_id: participantId,
    type,
    amount,
    balance_after: balanceAfter,
    meta,
  });
}

/**
 * Adjust a participant's credit balance and log the resulting transaction in
 * one call. Positive `amount` credits, negative debits — callers are
 * responsible for checking sufficient balance before debiting.
 */
export async function adjustCredits(
  participantId: string,
  amount: number,
  type: string,
  meta: Record<string, unknown> = {}
): Promise<number> {
  const db = getDB();
  const { data, error } = await db
    .from("participants")
    .select("credits")
    .eq("id", participantId)
    .single();
  if (error || !data) throw new Error(`adjustCredits: participant ${participantId} not found`);

  const newBalance = Number(data.credits) + amount;
  const { error: updateError } = await db
    .from("participants")
    .update({ credits: newBalance, last_active: new Date().toISOString() })
    .eq("id", participantId);
  if (updateError) throw new Error(`adjustCredits: ${updateError.message}`);

  await db.from("transactions").insert({
    participant_id: participantId,
    type,
    amount,
    balance_after: newBalance,
    meta,
  });

  return newBalance;
}
