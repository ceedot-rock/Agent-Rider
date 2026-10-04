/**
 * Redeemable promo codes — 3 free months of Rider access for agent recruitment.
 *
 * Model (Corey, 2026-10-04):
 * - One master code is offered to 20 seed agents; up to 500 total redemptions.
 * - Each redemption grants 3 free months: toll-gate charges are waived while
 *   `comped_until` is in the future (see credits.ts).
 * - Each comped agent may refer up to 10 other agents; a referred agent who
 *   registers with the referrer's referral code is comped too (same 3 months).
 * - Every comp grant — seed or referred — counts toward the 500 cap.
 * - The existing referral join bonus (+5 credits to the referrer, `referral_join_bonus`
 *   ledger entry) still applies on top.
 *
 * Storage: Supabase `promo_codes` table with disk fallback
 * (`data/promo-codes.json`), same pattern as agents.ts. Only code hashes are
 * stored; the plaintext code is shown once at creation.
 */
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDB } from "@/lib/db";

export const PROMO_BENEFIT_MONTHS = 3;
export const PROMO_MAX_REDEMPTIONS = 500;
export const PROMO_MAX_REFERRALS_PER_AGENT = 10;
export const PROMO_CODE_PREFIX = "RIDER-";

export interface PromoCodeStatus {
  label: string;
  codePrefix: string;
  redemptions: number;
  maxRedemptions: number;
  benefitMonths: number;
  active: boolean;
  remaining: number;
}

interface PromoCodeRow {
  code_hash: string;
  code_prefix: string;
  label: string;
  max_redemptions: number;
  redemptions: number;
  benefit_months: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function promoDiskPath(): string {
  return join(process.cwd(), "data", "promo-codes.json");
}

function readPromoDisk(): PromoCodeRow[] {
  const p = promoDiskPath();
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(list) ? (list as PromoCodeRow[]) : [];
  } catch {
    return [];
  }
}

function writePromoDisk(list: PromoCodeRow[]): void {
  const p = promoDiskPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(list, null, 2));
}

function participantsDiskPath(): string {
  return join(process.cwd(), "data", "participants.json");
}

function readParticipantsDisk(): Array<{
  id: string;
  comped_until?: string | null;
  comped_referrals?: number;
}> {
  const p = participantsDiskPath();
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeParticipantsDisk(
  list: Array<Record<string, unknown>>
): void {
  const p = participantsDiskPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(list, null, 2));
}

/** Generate a human-readable promo code, e.g. RIDER-7KQ2XA. */
export function generatePromoCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no lookalikes
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[randomBytes(1)[0] % alphabet.length];
  }
  return `${PROMO_CODE_PREFIX}${suffix}`;
}

function getDBOrNull(): ReturnType<typeof getDB> | null {
  try {
    return getDB();
  } catch {
    return null;
  }
}

/**
 * Create a new promo code. Returns the PLAINTEXT code — show it once, only the
 * hash is stored.
 */
export async function createPromoCode(opts: {
  label: string;
  createdBy?: string | null;
  maxRedemptions?: number;
  benefitMonths?: number;
}): Promise<{ code: string; status: PromoCodeStatus }> {
  const code = generatePromoCode();
  const row: PromoCodeRow = {
    code_hash: hashCode(code),
    code_prefix: code.slice(0, 12),
    label: opts.label,
    max_redemptions: opts.maxRedemptions ?? PROMO_MAX_REDEMPTIONS,
    redemptions: 0,
    benefit_months: opts.benefitMonths ?? PROMO_BENEFIT_MONTHS,
    active: true,
    created_by: opts.createdBy ?? null,
    created_at: new Date().toISOString(),
  };
  const db = getDBOrNull();
  if (db) {
    const { error } = await db.from("promo_codes").insert(row);
    if (error) throw new Error(`createPromoCode: ${error.message}`);
  } else {
    const list = readPromoDisk();
    list.push(row);
    writePromoDisk(list);
  }
  return {
    code,
    status: {
      label: row.label,
      codePrefix: row.code_prefix,
      redemptions: 0,
      maxRedemptions: row.max_redemptions,
      benefitMonths: row.benefit_months,
      active: true,
      remaining: row.max_redemptions,
    },
  };
}

async function findPromoRow(code: string): Promise<PromoCodeRow | null> {
  const hashed = hashCode(code);
  const db = getDBOrNull();
  if (db) {
    try {
      const { data } = await db.from("promo_codes").select("*").eq("code_hash", hashed).single();
      return (data as PromoCodeRow | null) ?? null;
    } catch {
      return null;
    }
  }
  return readPromoDisk().find((r) => r.code_hash === hashed) ?? null;
}

async function bumpRedemptions(row: PromoCodeRow): Promise<void> {
  const db = getDBOrNull();
  if (db) {
    await db.from("promo_codes").update({ redemptions: row.redemptions + 1 }).eq("code_hash", row.code_hash);
  } else {
    const list = readPromoDisk();
    const idx = list.findIndex((r) => r.code_hash === row.code_hash);
    if (idx >= 0) {
      list[idx] = { ...list[idx], redemptions: list[idx].redemptions + 1 };
      writePromoDisk(list);
    }
  }
}

export async function getPromoStatus(code: string): Promise<PromoCodeStatus | null> {
  const row = await findPromoRow(code);
  if (!row) return null;
  return {
    label: row.label,
    codePrefix: row.code_prefix,
    redemptions: row.redemptions,
    maxRedemptions: row.max_redemptions,
    benefitMonths: row.benefit_months,
    active: row.active,
    remaining: Math.max(0, row.max_redemptions - row.redemptions),
  };
}

function compedUntilISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

async function applyComp(participantId: string, months: number, codeHash: string | null): Promise<void> {
  const until = compedUntilISO(months);
  const db = getDBOrNull();
  if (db) {
    const { error } = await db
      .from("participants")
      .update({ comped_until: until, comped_via: codeHash, last_active: new Date().toISOString() })
      .eq("id", participantId);
    // Soft: column not migrated yet — surface a clear error, don't silently skip.
    if (error) throw new Error(`applyComp: ${error.message}`);
    return;
  }
  const list = readParticipantsDisk() as Array<Record<string, unknown>>;
  const idx = list.findIndex((r) => r.id === participantId);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      comped_until: until,
      comped_via: codeHash,
      last_active: new Date().toISOString(),
    };
    writeParticipantsDisk(list);
  }
}

/**
 * Redeem a promo code for a participant. Grants `benefit_months` of comped
 * Rider access. Enforces the total redemption cap.
 */
export async function redeemPromoCode(opts: {
  code: string;
  participantId: string;
}): Promise<{ ok: true; compedUntil: string } | { ok: false; reason: string }> {
  const row = await findPromoRow(opts.code);
  if (!row) return { ok: false, reason: "unknown_code" };
  if (!row.active) return { ok: false, reason: "code_inactive" };
  if (row.redemptions >= row.max_redemptions) return { ok: false, reason: "cap_reached" };
  const until = compedUntilISO(row.benefit_months);
  try {
    await applyComp(opts.participantId, row.benefit_months, row.code_hash);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "comp_failed" };
  }
  await bumpRedemptions(row);
  return { ok: true, compedUntil: until };
}

interface CompState {
  compedUntil: string | null;
  compedReferrals: number;
  compedVia: string | null;
}

async function readCompState(participantId: string): Promise<CompState | null> {
  const db = getDBOrNull();
  if (db) {
    try {
      const { data } = await db
        .from("participants")
        .select("comped_until, comped_referrals, comped_via")
        .eq("id", participantId)
        .single();
      if (!data) return null;
      return {
        compedUntil: (data.comped_until as string | null) ?? null,
        compedReferrals: Number(data.comped_referrals ?? 0),
        compedVia: (data.comped_via as string | null) ?? null,
      };
    } catch {
      return null;
    }
  }
  const row = readParticipantsDisk().find((r) => r.id === participantId);
  if (!row) return null;
  return {
    compedUntil: row.comped_until ?? null,
    compedReferrals: Number(row.comped_referrals ?? 0),
    compedVia: (row as { comped_via?: string | null }).comped_via ?? null,
  };
}

/** True while the participant's comped access is still in the future. */
export function isComped(compedUntil: string | null | undefined): boolean {
  if (!compedUntil) return false;
  return new Date(compedUntil).getTime() > Date.now();
}

export async function isCompedById(participantId: string): Promise<boolean> {
  const state = await readCompState(participantId);
  return isComped(state?.compedUntil);
}

/**
 * Grant comped access to a referred joiner. The referrer must currently be
 * comped and have granted fewer than PROMO_MAX_REFERRALS_PER_AGENT comped
 * referrals. The grant counts against the same promo code's 500 total cap.
 */
export async function grantCompedReferral(opts: {
  referrerId: string;
  joinerId: string;
  benefitMonths?: number;
}): Promise<{ ok: true; compedUntil: string } | { ok: false; reason: string }> {
  const state = await readCompState(opts.referrerId);
  if (!state) return { ok: false, reason: "referrer_not_found" };
  if (!isComped(state.compedUntil)) return { ok: false, reason: "referrer_not_comped" };
  if (!state.compedVia) return { ok: false, reason: "no_promo_code" };
  if (state.compedReferrals >= PROMO_MAX_REFERRALS_PER_AGENT) {
    return { ok: false, reason: "referral_cap_reached" };
  }
  const promoRow = await findPromoRowByHash(state.compedVia);
  if (!promoRow || !promoRow.active) return { ok: false, reason: "code_inactive" };
  if (promoRow.redemptions >= promoRow.max_redemptions) return { ok: false, reason: "cap_reached" };
  const months = opts.benefitMonths ?? promoRow.benefit_months;
  const until = compedUntilISO(months);
  try {
    await applyComp(opts.joinerId, months, promoRow.code_hash);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "comp_failed" };
  }
  await bumpRedemptions(promoRow);
  const db = getDBOrNull();
  if (db) {
    await db
      .from("participants")
      .update({ comped_referrals: state.compedReferrals + 1 })
      .eq("id", opts.referrerId);
  } else {
    const list = readParticipantsDisk() as Array<Record<string, unknown>>;
    const idx = list.findIndex((r) => r.id === opts.referrerId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], comped_referrals: state.compedReferrals + 1 };
      writeParticipantsDisk(list);
    }
  }
  return { ok: true, compedUntil: until };
}

async function findPromoRowByHash(codeHash: string): Promise<PromoCodeRow | null> {
  const db = getDBOrNull();
  if (db) {
    try {
      const { data } = await db.from("promo_codes").select("*").eq("code_hash", codeHash).single();
      return (data as PromoCodeRow | null) ?? null;
    } catch {
      return null;
    }
  }
  return readPromoDisk().find((r) => r.code_hash === codeHash) ?? null;
}
