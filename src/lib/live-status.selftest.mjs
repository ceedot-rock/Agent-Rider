/**
 * Catalog LIVE vs PARKED honesty selftest.
 * Run: cd src && npm run selftest:live-status
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const liveSrc = readFileSync(join(__dirname, "live-status.ts"), "utf8");
assert.match(liveSrc, /LIVE_CAPABILITIES/);
assert.match(liveSrc, /PARKED_CAPABILITIES/);
assert.match(liveSrc, /amp_settle/);
assert.match(liveSrc, /file_share/);
assert.match(liveSrc, /host_attestation/);
assert.match(liveSrc, /xpay_hop/);
assert.match(liveSrc, /NOT live/);
assert.doesNotMatch(liveSrc, /AMP settle is live|AMP live hop/i);
assert.doesNotMatch(liveSrc, /\bar_[A-Za-z0-9]{8,}/);

const discovery = readFileSync(join(__dirname, "../app/api/discovery/route.ts"), "utf8");
assert.match(discovery, /liveVsParkedCatalog/);
assert.match(discovery, /live_vs_parked/);

const agentJson = readFileSync(join(__dirname, "../app/.well-known/agent.json/route.ts"), "utf8");
assert.match(agentJson, /liveVsParkedCatalog/);

const agentsJson = JSON.parse(readFileSync(join(__dirname, "../public/agents.json"), "utf8"));
assert.ok(agentsJson.live_vs_parked?.live?.length >= 3);
assert.ok(agentsJson.live_vs_parked?.parked_or_planned?.some((x) => x.id === "amp_settle"));
assert.ok(agentsJson.live_vs_parked?.parked_or_planned?.some((x) => x.id === "file_share"));
assert.ok(agentsJson.live_vs_parked?.parked_or_planned?.some((x) => x.id === "host_attestation"));
assert.match(agentsJson.honesty.host_attestation, /PARKED/i);
assert.match(agentsJson.live_vs_parked.plain_english, /NOT live|not live/i);
assert.match(agentsJson.honesty.amp, /PARKED/i);
assert.match(agentsJson.honesty.file_sharing, /PLANNED|Coming next|not live/i);

const llms = readFileSync(join(__dirname, "../public/llms.txt"), "utf8");
assert.match(llms, /## LIVE vs PARKED/);
assert.match(llms, /\*\*AMP settle\*\*.*NOT/);
assert.match(llms, /Host attestation.*PARKED|PARKED until proven/i);

const agentsTxt = readFileSync(join(__dirname, "../public/agents.txt"), "utf8");
assert.match(agentsTxt, /LIVE today:/);
assert.match(agentsTxt, /PARKED: AMP/);
assert.match(agentsTxt, /host attestation/i);

const home = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
assert.match(home, /id="live-status"/);
assert.match(home, /PARKED \/ PLANNED — NOT LIVE/);

const readme = readFileSync(join(__dirname, "../../README.md"), "utf8");
assert.match(readme, /## LIVE vs PARKED/);

console.log("live-status.selftest: ok");
