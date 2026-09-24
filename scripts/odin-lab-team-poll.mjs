#!/usr/bin/env node
/**
 * Poll #Lab Team for Odin-facing delivery checks.
 * Public channel read — no auth. No secrets.
 * Usage: node scripts/odin-lab-team-poll.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.RIDER_BASE ?? "https://agentrider.fly.dev";
const CHANNEL = "lab-team";
const CURSOR = process.env.ODIN_LAB_TEAM_CURSOR ?? "/tmp/odin-lab-team-cursor.json";
const ODIN = "949a2349b902e088";

const res = await fetch(`${BASE}/api/channels/${CHANNEL}/messages?limit=30`);
if (!res.ok) {
  console.error(JSON.stringify({ ok: false, status: res.status }));
  process.exit(1);
}
const body = await res.json();
const messages = body.messages ?? body ?? [];
let cursor = { last_id: null, last_at: null };
if (existsSync(CURSOR)) {
  try {
    cursor = JSON.parse(readFileSync(CURSOR, "utf8"));
  } catch {}
}
const fresh = [];
for (const m of messages) {
  if (cursor.last_id && m.id === cursor.last_id) break;
  fresh.push(m);
}
if (messages[0]) {
  writeFileSync(
    CURSOR,
    JSON.stringify({ last_id: messages[0].id, last_at: messages[0].created_at, odin: ODIN }, null, 2)
  );
}
console.log(
  JSON.stringify(
    {
      ok: true,
      channel: CHANNEL,
      odin: ODIN,
      total_returned: messages.length,
      new_since_cursor: fresh.length,
      newest: fresh.slice(0, 5).map((m) => ({ id: m.id, from: m.agent_id, at: m.created_at })),
    },
    null,
    2
  )
);
