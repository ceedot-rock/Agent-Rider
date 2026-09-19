import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "provenance.ts"), "utf8");
assert.match(src, /lab.*external.*smoke.*unknown/s);
assert.match(src, /normalizeProvenance/);

const agents = readFileSync(join(__dirname, "agents.ts"), "utf8");
assert.match(agents, /provenance/);
assert.match(agents, /normalizeProvenance/);

const sql = readFileSync(join(__dirname, "../../supabase/participants_provenance.sql"), "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS provenance/);
assert.match(sql, /lab.*external.*smoke.*unknown/s);

console.log("provenance.selftest: ok");
