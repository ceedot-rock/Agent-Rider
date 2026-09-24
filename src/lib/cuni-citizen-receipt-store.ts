/**
 * CuNi citizen receipt store — Studio → Rider HTTP receive / bind.
 *
 * Persists PASS receipts pushed by CuNi Studio (or merchant/agent) so Execute
 * (contract / settle / claim) can bind by source_hash.
 *
 * Honesty:
 *   - This is the Rider RECEIVE path (Studio POSTs here). Rider does NOT call Studio.
 *   - Outbound Rider→Studio verify remains PARKED.
 *   - Fund path = Rider settle / XPay (never PCC as money layer).
 *   - Never log or embed ar_ values.
 *
 * Storage: in-process memory (always) + optional Supabase table when configured.
 */

import {
  validateCitizenReceiptShape,
  type CitizenReceiptPass,
} from "@/lib/cuni-citizen-gate";
import { resolveSupabaseCreds, getDB } from "@/lib/db";

export const CUNI_STUDIO_INGEST_KEY_ENV = "CUNI_STUDIO_INGEST_KEY" as const;
export const CUNI_CITIZEN_RECEIPT_INGEST_OPEN_ENV =
  "CUNI_CITIZEN_RECEIPT_INGEST_OPEN" as const;

export type CitizenReceiptBind = {
  agent_id?: string;
  job_id?: string;
  contract_id?: string;
  task_id?: string;
};

export type StoredCitizenReceipt = {
  id: string;
  source_hash: string;
  exactness: CitizenReceiptPass["exactness"];
  publisher: string;
  bind: CitizenReceiptBind;
  received_at: string;
  /** How the receipt arrived — never claims Rider called Studio. */
  ingress: "studio_http" | "contracts_register" | "merchant" | "agent";
};

const memory = new Map<string, StoredCitizenReceipt>();

export function _resetCitizenReceiptMemoryForTests(): void {
  memory.clear();
}

export function isCitizenReceiptIngestOpen(): boolean {
  return process.env.CUNI_CITIZEN_RECEIPT_INGEST_OPEN === "true";
}

export function getConfiguredStudioIngestKey(): string | null {
  const v = process.env.CUNI_STUDIO_INGEST_KEY;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

/**
 * Auth for Studio → Rider receipt ingest.
 * Prefer shared CUNI_STUDIO_INGEST_KEY when set; else merchant / api_key;
 * else open only when CUNI_CITIZEN_RECEIPT_INGEST_OPEN=true.
 */
export type IngestAuthOk =
  | { ok: true; mode: "ingest_key" | "merchant" | "api_key" | "open" }
  | { ok: false; status: 401 | 403; error: string; hint: string };

export function checkCitizenReceiptIngestAuth(input: {
  bearer?: string | null;
  ingestKeyHeader?: string | null;
  merchantKey?: string | null;
  /** Caller already resolved Bearer as a participant api_key. */
  apiKeyResolved?: boolean;
  /** Caller already validated merchant subscription active. */
  merchantOk?: boolean;
}): IngestAuthOk {
  const configured = getConfiguredStudioIngestKey();
  const bearer = input.bearer?.trim() || null;
  const headerKey = input.ingestKeyHeader?.trim() || null;

  if (configured) {
    if (bearer === configured || headerKey === configured) {
      return { ok: true, mode: "ingest_key" };
    }
    // Ingest key is configured — do not fall through to open.
    if (input.merchantOk) return { ok: true, mode: "merchant" };
    if (input.apiKeyResolved) return { ok: true, mode: "api_key" };
    return {
      ok: false,
      status: 401,
      error: "unauthorized_ingest",
      hint: "Send Authorization: Bearer <CUNI_STUDIO_INGEST_KEY> or X-Cuni-Ingest-Key (or X-Merchant-Key / participant api_key)",
    };
  }

  if (input.merchantOk) return { ok: true, mode: "merchant" };
  if (input.apiKeyResolved) return { ok: true, mode: "api_key" };
  if (isCitizenReceiptIngestOpen()) return { ok: true, mode: "open" };

  return {
    ok: false,
    status: 401,
    error: "unauthorized_ingest",
    hint: "Set CUNI_STUDIO_INGEST_KEY on Rider (and matching Bearer from Studio), or send X-Merchant-Key / participant api_key, or set CUNI_CITIZEN_RECEIPT_INGEST_OPEN=true for temporary open ingest",
  };
}

function newId(): string {
  return `cr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function supabaseReady(): boolean {
  const c = resolveSupabaseCreds();
  return Boolean(c.url && c.key && c.keyKind !== "placeholder" && c.keyKind !== "missing");
}

/**
 * Persist a PASS citizen receipt. Idempotent on source_hash (updates bind merge).
 * Refuses non-PASS shapes.
 */
export async function bindCitizenReceipt(input: {
  receipt: unknown;
  bind?: CitizenReceiptBind;
  publisher?: string;
  ingress?: StoredCitizenReceipt["ingress"];
}): Promise<
  | { ok: true; record: StoredCitizenReceipt; idempotent: boolean }
  | { ok: false; status: 400; error: string; missing?: string[] }
> {
  const validated = validateCitizenReceiptShape(input.receipt);
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      error: validated.error,
      missing: validated.missing,
    };
  }

  const source_hash = validated.receipt.source_hash;
  const bind: CitizenReceiptBind = { ...(input.bind ?? {}) };
  const publisher = input.publisher?.trim() || "studio";
  const ingress = input.ingress ?? "studio_http";
  const now = new Date().toISOString();

  const existingMem = memory.get(source_hash);
  if (existingMem) {
    const merged: StoredCitizenReceipt = {
      ...existingMem,
      exactness: validated.receipt.exactness,
      publisher: publisher || existingMem.publisher,
      bind: { ...existingMem.bind, ...bind },
      received_at: now,
      ingress,
    };
    memory.set(source_hash, merged);
    await upsertSupabase(merged).catch(() => undefined);
    return { ok: true, record: merged, idempotent: true };
  }

  const record: StoredCitizenReceipt = {
    id: newId(),
    source_hash,
    exactness: validated.receipt.exactness,
    publisher,
    bind,
    received_at: now,
    ingress,
  };
  memory.set(source_hash, record);
  await upsertSupabase(record).catch(() => undefined);
  return { ok: true, record, idempotent: false };
}

async function upsertSupabase(record: StoredCitizenReceipt): Promise<void> {
  if (!supabaseReady()) return;
  try {
    const db = getDB();
    const row = {
      id: record.id,
      source_hash: record.source_hash,
      exactness: record.exactness,
      agent_id: record.bind.agent_id ?? null,
      job_id: record.bind.job_id ?? null,
      contract_id: record.bind.contract_id ?? null,
      task_id: record.bind.task_id ?? null,
      publisher: record.publisher,
      bind: record.bind,
      ingress: record.ingress,
      received_at: record.received_at,
    };
    const { error } = await db.from("cuni_citizen_receipts").upsert(row, {
      onConflict: "source_hash",
    });
    if (error) {
      // Table may not exist yet — memory store remains source of truth for this process.
      console.error("cuni_citizen_receipts upsert skipped", error.message);
    }
  } catch (err) {
    console.error("cuni_citizen_receipts upsert failed", (err as Error).message);
  }
}

export async function getCitizenReceiptByHash(
  sourceHash: string
): Promise<StoredCitizenReceipt | null> {
  const key = sourceHash.trim();
  if (!key) return null;
  const mem = memory.get(key);
  if (mem) return mem;

  if (!supabaseReady()) return null;
  try {
    const db = getDB();
    const { data } = await db
      .from("cuni_citizen_receipts")
      .select("*")
      .eq("source_hash", key)
      .maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const bind =
      row.bind && typeof row.bind === "object"
        ? (row.bind as CitizenReceiptBind)
        : {
            agent_id: typeof row.agent_id === "string" ? row.agent_id : undefined,
            job_id: typeof row.job_id === "string" ? row.job_id : undefined,
            contract_id:
              typeof row.contract_id === "string" ? row.contract_id : undefined,
            task_id: typeof row.task_id === "string" ? row.task_id : undefined,
          };
    const exact =
      row.exactness && typeof row.exactness === "object"
        ? (row.exactness as CitizenReceiptPass["exactness"])
        : { passed: true as const };
    const record: StoredCitizenReceipt = {
      id: String(row.id),
      source_hash: String(row.source_hash),
      exactness: exact.passed === true ? exact : { passed: true },
      publisher: typeof row.publisher === "string" ? row.publisher : "studio",
      bind,
      received_at:
        typeof row.received_at === "string"
          ? row.received_at
          : new Date().toISOString(),
      ingress:
        row.ingress === "contracts_register" ||
        row.ingress === "merchant" ||
        row.ingress === "agent"
          ? row.ingress
          : "studio_http",
    };
    memory.set(record.source_hash, record);
    return record;
  } catch {
    return null;
  }
}

/** Extract optional bind fields from a request body. */
export function extractCitizenReceiptBind(body: unknown): CitizenReceiptBind {
  if (!body || typeof body !== "object") return {};
  const o = body as Record<string, unknown>;
  const bindRaw =
    o.bind && typeof o.bind === "object"
      ? (o.bind as Record<string, unknown>)
      : o;
  const out: CitizenReceiptBind = {};
  for (const key of ["agent_id", "job_id", "contract_id", "task_id"] as const) {
    const v = bindRaw[key] ?? o[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}
