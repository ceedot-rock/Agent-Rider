import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDB } from "@/lib/db";
import { normalizeProvenance, type Provenance } from "@/lib/provenance";

export type ParticipantType = "agent" | "human";
export type ParticipantStore = "supabase" | "disk";
export type { Provenance };

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
  /** Seat origin label — lab|external|smoke|unknown. Not KYC. */
  provenance: Provenance;
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
  provenance?: string | null;
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
    provenance: normalizeProvenance(row.provenance),
    registeredAt: row.registered_at,
    lastActive: row.last_active,
  };
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function diskPath(): string {
  return join(process.cwd(), "data", "participants.json");
}

function readDisk(): ParticipantRow[] {
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
  /** Optional; defaults unknown. Invalid values coerced to unknown. */
  provenance?: Provenance | string | null;
}

export interface RegisterResult {
  participant: Participant;
  apiKey: string;
  store: ParticipantStore;
  dbError?: string;
}

export async function registerParticipant(input: RegisterInput): Promise<RegisterResult> {
  // Nullable: without Supabase creds the disk store carries registration.
  let db: ReturnType<typeof getDB> | null = null;
  try {
    db = getDB();
  } catch {
    db = null;
  }
  const id = randomBytes(8).toString("hex");
  const apiKey = "ar_" + randomBytes(20).toString("hex");
  const bonus = await signupBonus();

  let referrerId: string | null = null;
  if (input.referralCode) {
    const hashed = hashApiKey(input.referralCode);
    if (db) {
      try {
        const { data } = await db.from("participants").select("id").eq("api_key_hash", hashed).single();
        referrerId = data?.id ?? null;
      } catch {
        referrerId = null;
      }
    }
    if (!referrerId) {
      referrerId = readDisk().find((row) => row.api_key_hash === hashed)?.id ?? null;
    }
  }

  const credits = bonus;

  const provenance = normalizeProvenance(input.provenance);
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
    provenance,
  };

  let row: ParticipantRow | null = null;
  let dbError: string | undefined;
  try {
    if (!db) throw new Error("disk-only");
    let { data, error } = await db.from("participants").insert(payload).select().single();
    // Soft: column not migrated yet — retry without provenance (defaults unknown in app layer).
    if (error && /provenance/i.test(error.message)) {
      const { provenance: _drop, ...withoutProv } = payload;
      ({ data, error } = await db.from("participants").insert(withoutProv).select().single());
    }
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
    } catch {
      /* ledger row exists even if the bonus tx fails */
    }
    // The advertised join bonus belongs to the REFERRER, not the joiner.
    if (referrerId) await rewardReferrer(referrerId, id).catch(() => {});
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

  // The advertised join bonus belongs to the REFERRER, not the joiner.
  if (referrerId) await rewardReferrer(referrerId, id).catch(() => {});

  return {
    participant: rowToParticipant(diskRow),
    apiKey,
    store: "disk",
    dbError,
  };
}

/**
 * Pays the advertised referral join bonus to the referrer: +5 credits with a
 * `referral_join_bonus` ledger entry on the REFERRER's account, plus +1 to
 * their `referrals` count. Works against Supabase with disk fallback.
 * Never throws — a failed reward must not break registration.
 */
export async function rewardReferrer(referrerId: string, newJoinerId: string): Promise<void> {
  try {
    await adjustCredits(referrerId, 5, "referral_join_bonus", { referredId: newJoinerId });
  } catch {
    return; // referrer unreachable — do not break registration
  }

  const db = (() => {
    try {
      return getDB();
    } catch {
      return null;
    }
  })();
  if (!db) {
    incrementDiskReferrals(referrerId);
    return;
  }
  try {
    const { data, error } = await db.from("participants").select("referrals").eq("id", referrerId).single();
    if (!error && data) {
      await db
        .from("participants")
        .update({ referrals: Number(data.referrals ?? 0) + 1, last_active: new Date().toISOString() })
        .eq("id", referrerId);
      return;
    }
  } catch {
    /* fall through to disk */
  }
  incrementDiskReferrals(referrerId);
}

/** +1 to a disk-store participant's referrals count. Never throws. */
function incrementDiskReferrals(participantId: string): void {
  try {
    const list = readDisk();
    const idx = list.findIndex((row) => row.id === participantId);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        referrals: Number(list[idx].referrals ?? 0) + 1,
        last_active: new Date().toISOString(),
      };
      writeDisk(list);
    }
  } catch {
    /* disk write failed — registration already succeeded */
  }
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
  let db: ReturnType<typeof getDB> | null = null;
  try {
    db = getDB();
  } catch {
    return; // disk-only mode: no ledger table
  }
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
  let db: ReturnType<typeof getDB> | null = null;
  try {
    db = getDB();
  } catch {
    db = null; // disk-only mode
  }
  if (db) {
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
  }

  const list = readDisk();
  const idx = list.findIndex((row) => row.id === participantId);
  if (idx < 0) throw new Error(`adjustCredits: participant ${participantId} not found`);
  const newBalance = Number(list[idx].credits) + amount;
  list[idx] = { ...list[idx], credits: newBalance, last_active: new Date().toISOString() };
  writeDisk(list);
  return newBalance;
}
