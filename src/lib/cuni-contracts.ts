import { getDB } from "@/lib/db";
import { createHash } from "crypto";

export interface ExactnessMeta {
  passed: boolean;
  checkedAt?: string;
  targets?: string[];
  stdoutMatch?: boolean;
}

export interface CuniPublishMeta {
  version?: string;
  source: string;
  sourceHash: string;
  exactness: ExactnessMeta;
  links?: Array<{
    name: string;
    params?: Array<{ name: string; type: string }>;
    returns?: string;
    handler?: string;
    remote?: string;
  }>;
  publishedAt?: string;
  publisher?: string;
}

export interface CuniContractRecord {
  id: string;
  source_hash: string;
  source: string;
  exactness: ExactnessMeta;
  links: unknown;
  publisher: string;
  published_at: string;
  status: string;
  created_at: string;
}

function normalizeMeta(raw: unknown): CuniPublishMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const meta =
    obj.meta && typeof obj.meta === "object"
      ? (obj.meta as Record<string, unknown>)
      : obj;

  const source = typeof meta.source === "string" ? meta.source : null;
  if (!source) return null;

  let sourceHash =
    typeof meta.sourceHash === "string" ? meta.sourceHash : null;
  if (!sourceHash) {
    sourceHash = createHash("sha256").update(source, "utf8").digest("hex");
  }

  const exact = (meta.exactness ?? {}) as Record<string, unknown>;
  const exactness: ExactnessMeta = {
    passed: exact.passed === true,
    checkedAt: typeof exact.checkedAt === "string" ? exact.checkedAt : undefined,
    targets: Array.isArray(exact.targets)
      ? (exact.targets as string[])
      : ["py", "go", "js"],
    stdoutMatch: exact.stdoutMatch === true || exact.passed === true,
  };

  return {
    version: typeof meta.version === "string" ? meta.version : "0.1",
    source,
    sourceHash,
    exactness,
    links: Array.isArray(meta.links) ? (meta.links as CuniPublishMeta["links"]) : [],
    publishedAt:
      typeof meta.publishedAt === "string"
        ? meta.publishedAt
        : new Date().toISOString(),
    publisher: typeof meta.publisher === "string" ? meta.publisher : "studio",
  };
}

/**
 * Register a verified CuNi publish payload.
 * Refuses unless exactness.passed === true.
 * Idempotent on sourceHash.
 */
export async function registerCuniContract(
  raw: unknown
): Promise<
  | { ok: true; contract: CuniContractRecord; idempotent: boolean }
  | { ok: false; status: number; error: string }
> {
  const meta = normalizeMeta(raw);
  if (!meta) {
    return { ok: false, status: 400, error: "expected publish metadata with source" };
  }
  if (!meta.exactness.passed) {
    return {
      ok: false,
      status: 400,
      error: "exactness.passed must be true — refuse register",
    };
  }

  const db = getDB();

  // Idempotent lookup
  const { data: existing } = await db
    .from("cuni_contracts")
    .select("*")
    .eq("source_hash", meta.sourceHash)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      contract: existing as CuniContractRecord,
      idempotent: true,
    };
  }

  const id = `ctr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const row = {
    id,
    source_hash: meta.sourceHash,
    source: meta.source,
    exactness: meta.exactness,
    links: meta.links ?? [],
    publisher: meta.publisher ?? "studio",
    published_at: meta.publishedAt ?? new Date().toISOString(),
    status: "active",
  };

  const { data, error } = await db.from("cuni_contracts").insert(row).select().single();
  if (error) {
    // Race: another insert won — return existing
    if (error.code === "23505") {
      const { data: raced } = await db
        .from("cuni_contracts")
        .select("*")
        .eq("source_hash", meta.sourceHash)
        .single();
      if (raced) {
        return { ok: true, contract: raced as CuniContractRecord, idempotent: true };
      }
    }
    console.error("cuni_contracts insert failed", error);
    return { ok: false, status: 500, error: "store_failed" };
  }

  return { ok: true, contract: data as CuniContractRecord, idempotent: false };
}

export async function listCuniContracts(limit = 50): Promise<CuniContractRecord[]> {
  const db = getDB();
  const { data } = await db
    .from("cuni_contracts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));
  return (data ?? []) as CuniContractRecord[];
}

export async function getCuniContract(
  idOrHash: string
): Promise<CuniContractRecord | null> {
  const db = getDB();
  const byId = await db.from("cuni_contracts").select("*").eq("id", idOrHash).maybeSingle();
  if (byId.data) return byId.data as CuniContractRecord;
  const byHash = await db
    .from("cuni_contracts")
    .select("*")
    .eq("source_hash", idOrHash)
    .maybeSingle();
  return (byHash.data as CuniContractRecord) ?? null;
}
