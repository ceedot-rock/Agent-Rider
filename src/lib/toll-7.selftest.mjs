/**
 * Toll 7 — portable memory: signed export + hosted transfer (tollkeeper Module F).
 * Ports EVERY edge case from ~/workspace/rider-toll/tollkeeper/test_memory.py
 * (7/7 green there) plus flag-off honesty and route source-shape checks.
 * No network, no secrets — devTollKeypair/jwksForTest only.
 * Run: cd src && npm run selftest:toll-7
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TollReceiptError,
  canonicalJson,
  signTollPayload,
  verifyTollEnvelope,
  tollEnvelopeId,
  devTollKeypair,
  jwksForTest,
} from "./toll-receipt-core.mjs";
import {
  MemoryError,
  SCHEMA_VERSION,
  TRANSFER_FEE_UUSDC,
  utcNow,
  validateMemories,
  buildExportPayload,
  validateExportPayload,
  blobHashFor,
  buildTransferReceiptPayload,
  validateTransferReceiptPayload,
} from "./toll-7-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

let ASSERTS = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); ASSERTS++; };
const ok = (v, m) => { assert.ok(v, m); ASSERTS++; };
const match = (v, re, m) => { assert.match(v, re, m); ASSERTS++; };
const noMatch = (v, re, m) => { assert.doesNotMatch(v, re, m); ASSERTS++; };
const throws = (fn, cls, m) => { assert.throws(fn, cls, m); ASSERTS++; };
const deepEq = (a, b, m) => { assert.deepEqual(a, b, m); ASSERTS++; };

// verify_export parity: sig verify + schema checks, raises EnvelopeError
// (TollReceiptError here) on bad signature, MemoryError on schema violations.
function verifyExport(envelope, jwks) {
  const payload = verifyTollEnvelope(envelope, jwks);
  return validateExportPayload(payload);
}

// store_blob parity against an in-memory stand-in for toll_memory_transfers:
// verify, from_agent match, content-address, ON CONFLICT DO NOTHING, receipt,
// 2c meter row. Returns { blob_hash, receipt }.
function makeMemStore(key, jwks) {
  const rows = new Map(); // blob_hash -> { envelope_json, receipt_json }
  const meter = [];
  function storeBlob(envelope, from_agent, to_host) {
    const payload = verifyExport(envelope, jwks);
    if (payload.agent_id !== from_agent)
      throw new MemoryError(
        `envelope agent_id ${JSON.stringify(payload.agent_id)} != from_agent ${JSON.stringify(from_agent)}`
      );
    const blob_hash = blobHashFor(envelope);
    if (!rows.has(blob_hash)) rows.set(blob_hash, { envelope_json: envelope });
    const receipt_payload = buildTransferReceiptPayload({
      blob_hash,
      from_agent,
      to_host,
      envelope_id: tollEnvelopeId(envelope),
      transferred_at: utcNow(),
    });
    const receipt = signTollPayload(receipt_payload, { privateKey: key.privateKey, kid: key.kid });
    rows.get(blob_hash).receipt_json = receipt;
    meter.push({ module: "memory", operation: "transfer", amount_uusdc: TRANSFER_FEE_UUSDC, ref_id: blob_hash });
    return [blob_hash, receipt];
  }
  function fetchBlob(blob_hash) {
    const row = rows.get(blob_hash);
    if (!row) throw new MemoryError(`unknown blob_hash ${JSON.stringify(blob_hash)}`);
    if (blobHashFor(row.envelope_json) !== blob_hash)
      throw new MemoryError("blob content does not match its hash (tampered)");
    return row.envelope_json;
  }
  function verifyReceipt(receipt_envelope) {
    return validateTransferReceiptPayload(verifyTollEnvelope(receipt_envelope, jwks));
  }
  function meterTotal(agent_id) {
    const hashes = new Set([...rows.entries()].filter(([, r]) => r.envelope_json.payload.agent_id === agent_id).map(([h]) => h));
    return meter.filter((m) => hashes.has(m.ref_id)).reduce((s, m) => s + m.amount_uusdc, 0);
  }
  return { rows, meter, storeBlob, fetchBlob, verifyReceipt, meterTotal };
}

const MEMORIES = [
  { kind: "fact", text: "principal prefers USDC on Base", confidence: 9 },
  { kind: "episode", text: "completed job j-123, delivered_ok=true", job_id: "j-123" },
];

const key = devTollKeypair("test-lab-1");
const jwks = jwksForTest(key.publicKey, key.kid);
const signOpts = { privateKey: key.privateKey, kid: key.kid };

// ── Consts: integer micro-USDC, schema v1 ──────────────────────────────────
eq(SCHEMA_VERSION, 1, "SCHEMA_VERSION is 1");
eq(TRANSFER_FEE_UUSDC, 20_000, "transfer fee is 2c = 20_000 micro-USDC");
ok(Number.isInteger(TRANSFER_FEE_UUSDC), "no float arithmetic on money");
match(utcNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "utcNow() is UTC ISO Z");

// ── buildExportPayload ─────────────────────────────────────────────────────
{
  const p = buildExportPayload({ agent_id: "agent:a", memories: MEMORIES, weights_ref: "sha256:abc123" });
  eq(p.type, "memory_export");
  eq(p.agent_id, "agent:a");
  eq(p.schema_version, 1);
  deepEq(p.memories, MEMORIES);
  eq(p.weights_ref, "sha256:abc123");
  ok("exported_at" in p, "exported_at present");
  match(p.exported_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const dflt = buildExportPayload({ agent_id: "agent:a", memories: [] });
  eq(dflt.weights_ref, null, "weights_ref defaults to null");
  const fixed = buildExportPayload({ agent_id: "agent:a", memories: [], exported_at: "2026-01-02T03:04:05Z" });
  eq(fixed.exported_at, "2026-01-02T03:04:05Z", "explicit exported_at honored");
}

// ── export refusals (every case from test_export_refusals) ─────────────────
throws(() => buildExportPayload({ agent_id: "", memories: MEMORIES }), MemoryError, "empty agent_id refused");
throws(() => buildExportPayload({ agent_id: 123, memories: MEMORIES }), MemoryError, "non-string agent_id refused");
throws(() => buildExportPayload({ agent_id: "agent:a", memories: "not-a-list" }), MemoryError, "memories not a list refused");
throws(() => buildExportPayload({ agent_id: "agent:a", memories: ["not-a-dict"] }), MemoryError, "memory not a dict refused");
// JS objects coerce keys to strings, so Python's `[{1: "x"}]` int-key case
// is vacuous here: it arrives as {"1": "x"} and validates. The key loop in
// validateMemories is kept for parity as defense-in-depth.
deepEq(Object.keys({ 1: "x" }), ["1"], "numeric keys stringify in JS");
buildExportPayload({ agent_id: "agent:a", memories: [{ 1: "x" }] });
throws(() => validateMemories([{ a: 1 }, null]), /memories\[1\]/, "index carried in message");

// ── export + verify round trip (free: no meter rows) ───────────────────────
{
  const store = makeMemStore(key, jwks);
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES, weights_ref: "sha256:abc123" }), signOpts);
  const payload = verifyExport(env, jwks);
  eq(payload.type, "memory_export");
  eq(payload.agent_id, "agent:a");
  eq(payload.schema_version, SCHEMA_VERSION);
  deepEq(payload.memories, MEMORIES);
  eq(payload.weights_ref, "sha256:abc123");
  ok("exported_at" in payload);
  eq(store.meterTotal("agent:a"), 0, "export is free: no meter rows");
}

// ── verify_export refusals (every case from test_verify_export_refusals) ───
{
  const attacker = devTollKeypair("attacker");
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }), signOpts);
  // tampered payload -> signature fails
  const tampered = JSON.parse(JSON.stringify(env));
  tampered.payload.memories = [{ kind: "fact", text: "lie" }];
  throws(() => verifyExport(tampered, jwks), TollReceiptError, "tampered envelope refused");
  // wrong kid -> unknown
  const env2 = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }),
    { privateKey: attacker.privateKey, kid: attacker.kid });
  throws(() => verifyExport(env2, jwks), TollReceiptError, "unknown kid refused");
  // bad schema version
  const bad = signTollPayload({ type: "memory_export", agent_id: "agent:a", schema_version: 2, memories: [] }, signOpts);
  throws(() => verifyExport(bad, jwks), MemoryError, "schema_version 2 refused");
  // wrong envelope type
  const notmem = signTollPayload({ type: "bond_stake", agent_id: "agent:a", schema_version: 1, memories: [] }, signOpts);
  throws(() => verifyExport(notmem, jwks), MemoryError, "non-memory envelope refused");
  // missing agent_id
  const noagent = signTollPayload({ type: "memory_export", schema_version: 1, memories: [] }, signOpts);
  throws(() => verifyExport(noagent, jwks), MemoryError, "missing agent_id refused");
  // bad memories inside a signed envelope
  const badmem = signTollPayload({ type: "memory_export", agent_id: "agent:a", schema_version: 1, memories: ["x"] }, signOpts);
  throws(() => verifyExport(badmem, jwks), MemoryError, "bad memories refused");
}

// ── store_blob + receipt (content-address, custody, 2c meter) ──────────────
{
  const store = makeMemStore(key, jwks);
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }), signOpts);
  const [blob_hash, receipt] = store.storeBlob(env, "agent:a", "host:fly-ewr-1");
  eq(blob_hash, createHash("sha256").update(canonicalJson(env), "utf8").digest("hex"),
    "blob_hash = sha256 of canonical envelope");
  eq(blob_hash.length, 64, "64 hex chars");
  const rp = store.verifyReceipt(receipt);
  eq(rp.type, "memory_transfer_receipt");
  eq(rp.blob_hash, blob_hash);
  eq(rp.from_agent, "agent:a");
  eq(rp.to_host, "host:fly-ewr-1");
  eq(rp.envelope_id, tollEnvelopeId(env));
  ok("transferred_at" in rp, "transferred_at present");
  match(rp.transferred_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  eq(store.meterTotal("agent:a"), TRANSFER_FEE_UUSDC, "2c metered to from_agent");
  deepEq(store.fetchBlob(blob_hash), env, "fetch round-trips bit-identical");
  // meter row shape
  deepEq(store.meter[0].module, "memory");
  deepEq(store.meter[0].operation, "transfer");
  deepEq(store.meter[0].amount_uusdc, 20_000);
  deepEq(store.meter[0].ref_id, blob_hash);
}

// ── store idempotent: same content -> same address ─────────────────────────
{
  const store = makeMemStore(key, jwks);
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }), signOpts);
  const [h1] = store.storeBlob(env, "agent:a", "host:x");
  const [h2] = store.storeBlob(env, "agent:a", "host:x");
  eq(h1, h2, "same content -> same address");
  eq(store.rows.size, 1, "ON CONFLICT DO NOTHING keeps one row");
}

// ── store refusals ─────────────────────────────────────────────────────────
{
  const store = makeMemStore(key, jwks);
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }), signOpts);
  throws(() => store.storeBlob(env, "agent:mallory", "host:x"), MemoryError, "from_agent mismatch refused");
  throws(() => store.fetchBlob("0".repeat(64)), MemoryError, "unknown blob refused");
}

// ── tamper-evident fetch ───────────────────────────────────────────────────
{
  const store = makeMemStore(key, jwks);
  const env = signTollPayload(buildExportPayload({ agent_id: "agent:a", memories: MEMORIES }), signOpts);
  const [blob_hash] = store.storeBlob(env, "agent:a", "host:x");
  store.rows.get(blob_hash).envelope_json = {
    payload: { type: "memory_export", agent_id: "agent:a", schema_version: 1, memories: [{ evil: 1 }] },
    sig: "x", kid: "y", alg: "ES256",
  };
  throws(() => store.fetchBlob(blob_hash), MemoryError, "tampered blob refused");
}

// ── receipt verification: wrong type refused ────────────────────────────────
{
  const store = makeMemStore(key, jwks);
  const fake = signTollPayload({ type: "memory_export", agent_id: "agent:a", schema_version: 1, memories: [] }, signOpts);
  throws(() => store.verifyReceipt(fake), MemoryError, "non-receipt envelope refused");
  throws(() => validateTransferReceiptPayload(null), MemoryError, "null receipt refused");
  const bad = buildTransferReceiptPayload({ blob_hash: "h", from_agent: "a", to_host: "t", envelope_id: "e" });
  eq(bad.type, "memory_transfer_receipt");
  throws(() => buildTransferReceiptPayload({ blob_hash: "", from_agent: "a", to_host: "t", envelope_id: "e" }),
    MemoryError, "empty blob_hash refused");
  throws(() => buildTransferReceiptPayload({ blob_hash: "h", from_agent: "", to_host: "t", envelope_id: "e" }),
    MemoryError, "empty from_agent refused");
  throws(() => buildTransferReceiptPayload({ blob_hash: "h", from_agent: "a", to_host: "", envelope_id: "e" }),
    MemoryError, "empty to_host refused");
}

// ── Flags: default OFF, dark until CoS smoke ───────────────────────────────
{
  const flags = readFileSync(join(__dirname, "toll-flags.ts"), "utf8");
  match(flags, /isToll7MemoryLive/);
  match(flags, /TOLL7_MEMORY_OFF_BODY/);
  match(flags, /toll7_memory_off/);
  match(flags, /TOLL7_MEMORY_LIVE/);
  match(flags, /Default OFF/);
}

// ── Route source shape ─────────────────────────────────────────────────────
{
  const route = readFileSync(join(__dirname, "../app/api/toll/v7/memory/export/route.ts"), "utf8");
  match(route, /isToll7MemoryLive/);
  match(route, /TOLL7_MEMORY_OFF_BODY/);
  match(route, /status:\s*503/);
  match(route, /resolveTollPayer/);
  match(route, /isTollPayerOk/);
  match(route, /checkMonthlyUsage\(`toll7_export:/);
  match(route, /reportToll7MemoryTransfer/);
  match(route, /validateMemories/);
  match(route, /buildExportPayload/);
  match(route, /signTollPayload/);
  match(route, /validateExportPayload/);
  match(route, /blobHashFor/);
  match(route, /buildTransferReceiptPayload/);
  match(route, /toll_memory_transfers/);
  match(route, /onConflict:\s*"blob_hash"/);
  match(route, /ignoreDuplicates:\s*true/);
  match(route, /toll_meter/);
  match(route, /TRANSFER_FEE_UUSDC/);
  match(route, /t7_\$/);
  match(route, /const PRICE_USD = 0\.02/);
  match(route, /price_usd: PRICE_USD/);
  match(route, /OPTIONS/);
  noMatch(route, /writeFile|createWriteStream|mkdirSync|appendFile/, "no filesystem writes in the route");
  noMatch(route, /parseFloat|Number\(.*price/, "no float money parsing");
}

// ── stripe reporter + schema landed ────────────────────────────────────────
{
  const stripe = readFileSync(join(__dirname, "stripe.ts"), "utf8");
  match(stripe, /reportToll7MemoryTransfer/);
  const sql = readFileSync(join(root, "supabase/schema.sql"), "utf8");
  match(sql, /CREATE TABLE IF NOT EXISTS toll_memory_transfers/);
  match(sql, /blob_hash TEXT PRIMARY KEY/);
  match(sql, /envelope_json JSONB/);
  match(sql, /CREATE TABLE IF NOT EXISTS toll_meter/);
  match(sql, /amount_uusdc BIGINT/);
}

console.log(`toll-7.selftest: ok (${ASSERTS} assertions — export/verify/store/receipt/meter + flag/route/schema shape)`);
