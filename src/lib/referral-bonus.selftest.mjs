/**
 * Referral join bonus — the advertised reward belongs to the REFERRER.
 *
 * Regression test for the 2026-10-02 defect: a valid referral credited the
 * extra 5 to the NEW JOINER and recorded `referral_join_bonus` on the joiner,
 * while the referrer's balance and `referrals` count were never touched —
 * contradicting the MCP copy ("Referring participant's API key, to earn a
 * join bonus").
 *
 * Disk-only (no SUPABASE_* env): exercises the disk store fallback.
 * Run: cd src && npm run selftest:referral-bonus
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the disk store: agents.ts resolves data/participants.json from cwd.
process.chdir(mkdtempSync(join(tmpdir(), "referral-bonus-")));

const agents = await import("./agents.ts");
const { registerParticipant, resolveByApiKey, rewardReferrer } = agents;

const signupBonus = 50; // first participant: n < 100 -> 50

// 1. Referrer joins with no code.
const ref = await registerParticipant({ name: "referrer", type: "agent" });
assert.equal(ref.store, "disk");
assert.equal(ref.participant.credits, signupBonus);
assert.equal(ref.participant.referrals, 0);
const referrerKey = ref.apiKey;
const referrerId = ref.participant.id;

// 2. Joiner uses the referrer's API key.
const joiner = await registerParticipant({
  name: "joiner-1",
  type: "agent",
  referralCode: referrerKey,
});
assert.equal(joiner.participant.credits, signupBonus, "joiner gets signup bonus ONLY — no extra 5");

// 3. Referrer earned the bonus: +5 credits, referrals 1.
const refAfter = await resolveByApiKey(referrerKey);
assert.ok(refAfter, "referrer resolvable");
assert.equal(refAfter.credits, signupBonus + 5, "referrer +5 join bonus");
assert.equal(refAfter.referrals, 1, "referrer referrals count 1");

// 4. Second referral stacks.
await registerParticipant({ name: "joiner-2", type: "agent", referralCode: referrerKey });
const refAfter2 = await resolveByApiKey(referrerKey);
assert.equal(refAfter2.credits, signupBonus + 10);
assert.equal(refAfter2.referrals, 2);

// 5. Invalid code: no crash, no phantom bonus, joiner still gets signup bonus.
const bad = await registerParticipant({ name: "joiner-bad", type: "agent", referralCode: "ar_nope" });
assert.equal(bad.participant.credits, signupBonus);
const refAfterBad = await resolveByApiKey(referrerKey);
assert.equal(refAfterBad.referrals, 2, "invalid code does not inflate referrals");

// 6. rewardReferrer never throws, even for an unknown id.
await rewardReferrer("deadbeefdeadbeef", "newjoiner");

console.log("referral-bonus selftest: PASS (6/6)");
