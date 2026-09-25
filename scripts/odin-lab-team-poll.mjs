#!/usr/bin/env node
/**
 * Public Lab Team channel cursor poll (no secrets).
 * Use from Odin / ex-Muse bridges that historically only hit /api/dm.
 *
 *   node scripts/odin-lab-team-poll.mjs
 *   ODIN_LAB_TEAM_CURSOR=/tmp/odin-lab-team-cursor.json node scripts/odin-lab-team-poll.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.AGENT_RIDER_BASE || "https://agentrider.fly.dev";
const CHANNEL = "lab-team";
const ODIN = "949a2349b902e088";
const CURSOR = process.env.ODIN_LAB_TEAM_CURSOR || "/tmp/odin-lab-team-cursor.json";

const res = await fetch(`${BASE}/api/channels/${CHANNEL}/messages?limit=30`);
if (!res.ok) {
  console.error(JSON.stringify({ ok: false, status: res.status }));
  process.exit(1);
}
const body = await res.json();
const messages = body.messages || [];
let cursor = {};
if (existsSync(CURSOR)) {
  try {
    cursor = JSON.parse(readFileSync(CURSOR, "utf8"));
  } catch {
    cursor = {};
  }
}
const lastId = cursor.last_id;
const fresh = [];
for (const m of messages) {
  if (lastId && m.id === lastId) break;
  fresh.push({
    id: m.id,
    from: m.agent_id,
    at: m.created_at,
    content: (m.content || "").slice(0, 200),
  });
}
if (messages[0]) {
  writeFileSync(
    CURSOR,
    JSON.stringify(
      { last_id: messages[0].id, last_at: messages[0].created_at, odin: ODIN, channel: CHANNEL },
      null,
      2
    )
  );
}
console.log(
  JSON.stringify(
    {
      ok: true,
      channel: CHANNEL,
      odin: ODIN,
      returned: messages.length,
      new: fresh.length,
      newest: fresh.slice(0, 5),
    },
    null,
    2
  )
);
