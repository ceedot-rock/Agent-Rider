import { createHash, randomBytes } from "crypto";
import { getDB } from "@/lib/db";

export type ParticipantType = "agent" | "human";
export type ParticipantStore = "supabase" | "disk";

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

function diskPath(): string {
  const { join } = require("node:path") as typeof import("node:path");
  return join(process.cwd(), "data", "participants.json");
}

function readDisk(): ParticipantRow[] {
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const p = diskPath();
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(list) ? (list as ParticipantRow[]) : [];
  } catch {
    return [];
  }
}

function writeDisk(list: ParticipantRow[]): void {
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { dirname } = require("node:path") as typeof import("node:path");
  const p = diskPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(list, null, 2));
}

export function countDiskParticipants(): number {
  return readDisk().length;
}

async function signupBonus(): Promise<number> {
  try {
    const db = getDB();
    const { count } = await db.from("participants").select("id", { count: "exact", head: true });
    const n = (count ?? 0) + countDiskParticipants();
    if (n < 100) return 50;
    if (n < 600) return 20;
    return 5;
  } catch {
    return 50;
  }
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
  store: ParticipantStore;
  dbError?: string;
}

export async function registerParticipant(input: RegisterInput): Promise<RegisterResult> {
  const db = getDB();
  const id = randomBytes(8).toString("hex");
  const apiKey = "ar_" + randomBytes(20).toString("hex");
  const bonus = await signupBonus();

  let referrerId: string | null = null;
  if (input.referralCode) {
    const hashed = hashApiKey(input.referralCode);
    try {
      const { data } = await db.from("participants").select("id").eq("api_key_hash", hashed).single();
      referrerId = data?.id ?? null;
    } catch {
      referrerId = null;
    }
    if (!referrerId) {
      referrerId = readDisk().find((row) => row.api_key_hash === hashed)?.id ?? null;
    }
  }

  const credits = bonus + (referrerId ? 5 : 0);

  const payload = {
    id,
    api_key_hash: hashApiKey(apiKey),
    api_key_prefix: apiKey.slice(0, 12),
    name: input.name,
    type: input.type,
    operator_id: input.operatorId ?? null,
    credits,
    referred_by: referrerId,
    capabilities: input.capabilities ?? [],
  };

  let row: ParticipantRow | null = null;
  let dbError: string | undefined;
  try {
    const { data, error } = await db.from("participants").insert(payload).select().single();
    if (!error && data) {
      row = data as ParticipantRow;
    } else if (error) {
      dbError = error.message.slice(0, 240);
    }
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message.slice(0, 240) : "insert_failed";
    row = null;
  }

  if (row) {
    try {
      await recordTransaction(id, "signup_bonus", bonus, { referrerId });
      if (referrerId) await recordTransaction(id, "referral_join_bonus", 5, { referrerId });
    } catch {
      /* ledger row exists even if the bonus tx fails */
    }
    return { participant: rowToParticipant(row), apiKey, store: "supabase" };
  }

  const diskRow: ParticipantRow = {
    ...payload,
    credits,
    tasks_completed: 0,
    referrals: 0,
    solana_wallet: null,
    registered_at: new Date().toISOString(),
    last_active: new Date().toISOString(),
  };
  const list = readDisk();
  list.push(diskRow);
  writeDisk(list);

  return {
    participant: rowToParticipant(diskRow),
    apiKey,
    store: "disk",
    dbError,
  };
}

export async function resolveByApiKey(apiKey: string): Promise<Participant | null> {
  const hashed = hashApiKey(apiKey);
  try {
    const db = getDB();
    const { data } = await db.from("participants").select("*").eq("api_key_hash", hashed).single();
    if (data) return rowToParticipant(data as ParticipantRow);
  } catch {
    /* fall through to disk */
  }
  const row = readDisk().find((item) => item.api_key_hash === hashed);
  return row ? rowToParticipant(row) : null;
}

export async function resolveById(id: string): Promise<Participant | null> {
  try {
    const db = getDB();
    const { data } = await db.from("participants").select("*").eq("id", id).single();
    if (data) return rowToParticipant(data as ParticipantRow);
  } catch {
    /* fall through to disk */
  }
  const row = readDisk().find((item) => item.id === id);
  return row ? rowToParticipant(row) : null;
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

export async function adjustCredits(
  participantId: string,
  amount: number,
  type: string,
  meta: Record<string, unknown> = {}
): Promise<number> {
  const db = getDB();
  const { data, error } = await db.from("participants").select("credits").eq("id", participantId).single();
  if (!error && data) {
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

  const list = readDisk();
  const idx = list.findIndex((row) => row.id === participantId);
  if (idx < 0) throw new Error(`adjustCredits: participant ${participantId} not found`);
  const newBalance = Number(list[idx].credits) + amount;
  list[idx] = { ...list[idx], credits: newBalance, last_active: new Date().toISOString() };
  writeDisk(list);
  return newBalance;
}
