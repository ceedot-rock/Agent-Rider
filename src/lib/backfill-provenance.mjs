/**
 * Optional heuristic backfill for participants.provenance.
 *
 * Safety:
 * - Never deletes or overwrites lab|external|smoke with a different value.
 * - Only updates rows where provenance is missing/null/'unknown'.
 * - Does not print ar_ keys or secrets.
 *
 * Heuristics (optional):
 * - Host Chat default roster agent_ids → lab
 * - name matching /smoke|test|selftest/i → smoke
 * - else leave unknown
 *
 * Usage (operator machine with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   cd src && node lib/backfill-provenance.mjs            # dry-run
 *   cd src && node lib/backfill-provenance.mjs --apply    # write
 *
 * Exit 0 on success; exit 1 if DB unreachable or apply errors.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("backfill-provenance: need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (no values printed)");
  process.exit(1);
}

/** Parse DEFAULT_HOST_CHAT_SEATS from host-chat-roster.ts without executing TS. */
function labIdsFromRosterSource() {
  const src = readFileSync(join(__dirname, "host-chat-roster.ts"), "utf8");
  const ids = [...src.matchAll(/agent_id:\s*"([a-f0-9]{16})"/g)].map((m) => m[1]);
  return new Set(ids);
}

function heuristic(row, labIds) {
  if (labIds.has(row.id)) return "lab";
  if (/smoke|selftest|\btest\b/i.test(row.name ?? "")) return "smoke";
  return null; // leave unknown
}

const db = createClient(url, key, { auth: { persistSession: false } });
const labIds = labIdsFromRosterSource();

const { data, error } = await db.from("participants").select("id, name, provenance");
if (error) {
  console.error("backfill-provenance: select failed:", error.message.slice(0, 160));
  process.exit(1);
}

const candidates = [];
for (const row of data ?? []) {
  const current = row.provenance ?? "unknown";
  if (current !== "unknown" && current != null && current !== "") continue;
  const next = heuristic(row, labIds);
  if (!next) continue;
  candidates.push({ id: row.id, name: row.name, from: current || "unknown", to: next });
}

console.log(
  `backfill-provenance: dry=${!APPLY} candidates=${candidates.length} lab_roster_ids=${labIds.size}`
);
for (const c of candidates.slice(0, 50)) {
  console.log(`  ${c.id}  ${c.from} → ${c.to}  name=${JSON.stringify(c.name)}`);
}
if (candidates.length > 50) console.log(`  … +${candidates.length - 50} more`);

if (!APPLY) {
  console.log("backfill-provenance: dry-run only (pass --apply to write). No data destroyed.");
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const c of candidates) {
  const { error: uErr } = await db
    .from("participants")
    .update({ provenance: c.to })
    .eq("id", c.id)
    .or("provenance.eq.unknown,provenance.is.null");
  if (uErr) {
    fail += 1;
    console.error(`  fail ${c.id}: ${uErr.message.slice(0, 120)}`);
  } else {
    ok += 1;
  }
}
console.log(`backfill-provenance: applied ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
