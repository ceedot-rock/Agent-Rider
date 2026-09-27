/**
 * Toll 7 — portable memory (tollkeeper Module F) pure logic.
 * Selftest-importable core. node:crypto only. Money in integer micro-USDC.
 *
 * Faithful port of ~/workspace/rider-toll/tollkeeper/memory.py:
 *   export_memory  → buildExportPayload (+ sign in route) — free
 *   verify_export  → verifyTollEnvelope (toll-receipt-core) + validateExportPayload
 *   store_blob     → verify + agent match + blobHashFor + buildTransferReceiptPayload
 *                    (+ sign in route) — 2¢ = 20_000 micro-USDC metered per transfer
 *   fetch_blob     → content-addressed, hash mismatch → MemoryError (tamper-evident)
 *   verify_receipt → verifyTollEnvelope + type check
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./toll-receipt-core.mjs";

export const SCHEMA_VERSION = 1;
export const TRANSFER_FEE_UUSDC = 20_000; // 2c per hosted transfer, metered only

export class MemoryError extends Error {}

/** UTC ISO "YYYY-MM-DDTHH:MM:SSZ" — mirrors Python datetime.now(timezone.utc). */
export function utcNow() {
  return new Date().toISOString().slice(0, 19) + "Z";
}

/**
 * memories must be a list; each entry a dict with string keys.
 * Throws MemoryError carrying the offending index.
 */
export function validateMemories(memories) {
  if (!Array.isArray(memories)) throw new MemoryError("memories must be a list");
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    if (typeof m !== "object" || m === null || Array.isArray(m))
      throw new MemoryError(`memories[${i}] must be a dict`);
    for (const k of Object.keys(m)) {
      if (typeof k !== "string")
        throw new MemoryError(`memories[${i}] has non-string key`);
    }
  }
  return memories;
}

/** Build the schema-v1 memory export payload (unsigned; route signs it). */
export function buildExportPayload({ agent_id, memories, weights_ref = null, exported_at }) {
  if (!agent_id || typeof agent_id !== "string")
    throw new MemoryError("agent_id must be a non-empty string");
  validateMemories(memories);
  return {
    type: "memory_export",
    agent_id,
    schema_version: SCHEMA_VERSION,
    memories,
    weights_ref,
    exported_at: exported_at ?? utcNow(),
  };
}

/**
 * Post-verify schema checks for a memory_export payload — mirrors the
 * schema half of Python verify_export (signature is verified separately).
 * Throws MemoryError with a clear reason.
 */
export function validateExportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new MemoryError("not a memory_export envelope");
  if (payload.type !== "memory_export")
    throw new MemoryError("not a memory_export envelope");
  if (payload.schema_version !== SCHEMA_VERSION)
    throw new MemoryError(
      `unsupported schema_version ${JSON.stringify(payload.schema_version)} (want ${SCHEMA_VERSION})`
    );
  if (!payload.agent_id || typeof payload.agent_id !== "string")
    throw new MemoryError("memory_export missing agent_id");
  validateMemories(payload.memories ?? []);
  return payload;
}

/** Content address of a signed envelope: sha256 hex of its canonical form. */
export function blobHashFor(envelope) {
  return createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex");
}

/** Build the unsigned transfer-receipt payload (route signs it with the lab key). */
export function buildTransferReceiptPayload({ blob_hash, from_agent, to_host, envelope_id, transferred_at }) {
  if (!blob_hash || typeof blob_hash !== "string")
    throw new MemoryError("blob_hash must be a non-empty string");
  if (!from_agent || typeof from_agent !== "string")
    throw new MemoryError("from_agent must be a non-empty string");
  if (!to_host || typeof to_host !== "string")
    throw new MemoryError("to_host must be a non-empty string");
  if (!envelope_id || typeof envelope_id !== "string")
    throw new MemoryError("envelope_id must be a non-empty string");
  return {
    type: "memory_transfer_receipt",
    blob_hash,
    from_agent,
    to_host,
    envelope_id,
    transferred_at: transferred_at ?? utcNow(),
  };
}

/** Receipt type check — mirrors the type half of Python verify_receipt. */
export function validateTransferReceiptPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new MemoryError("not a memory_transfer_receipt envelope");
  if (payload.type !== "memory_transfer_receipt")
    throw new MemoryError("not a memory_transfer_receipt envelope");
  return payload;
}
