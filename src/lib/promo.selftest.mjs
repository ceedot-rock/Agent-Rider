/**
 * Redeemable promo codes — 3 free months of Rider access.
 *
 * Covers Corey's 2026-10-04 agent-recruit offer: one master code, up to 500
 * total redemptions, each comped agent may extend the comp to up to 10
 * referred agents. Comped agents have toll-gate charges waived while
 * comped_until is in the future.
 *
 * Disk-only (no SUPABASE_* env): exercises the disk store fallback.
 * Run: cd src && npm run selftest:promo
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the disk store: agents.ts / promo.ts resolve data/*.json from cwd.
process.chdir(mkdtempSync(join(tmpdir(), "promo-")));

const promo = await import("./promo.ts");
const agents = await import("./agents.ts");
const credits = await import("./credits.ts");

const {
  createPromoCode,
  getPromoStatus,
  redeemPromoCode,
  grantCompedReferral,
  isComped,
  PROMO_MAX_REDEMPTIONS,
  PROMO_MAX_REFERRALS_PER_AGENT,
} = promo;
const { registerParticipant, resolveById } = agents;

// 1. Create the master code.
const { code, status } = await createPromoCode({ label: "founding-agents-500" });
assert.match(code, /^RIDER-[A-Z2-9]{6}$/, "code format");
assert.equal(status.maxRedemptions, PROMO_MAX_REDEMPTIONS);
assert.equal(status.remaining, 500);
assert.equal(status.benefitMonths, 3);

// 2. Seed agent redeems at registration -> comped ~3 months out.
const seed = await registerParticipant({ name: "seed-1", type: "agent", promoCode: code });
assert.equal(seed.store, "disk");
assert.equal(seed.promoError, undefined);
assert.ok(seed.participant.compedUntil, "seed is comped");
const compDate = new Date(seed.participant.compedUntil);
const now = new Date();
const monthDiff =
  (compDate.getFullYear() - now.getFullYear()) * 12 + (compDate.getMonth() - now.getMonth());
assert.equal(monthDiff, 3, "comp lasts 3 calendar months");

// 3. Bad code -> promoError, not comped.
const bad = await registerParticipant({ name: "bad-code", type: "agent", promoCode: "RIDER-NOPE00" });
assert.equal(bad.promoError, "unknown_code");
assert.equal(bad.participant.compedUntil, null);

// 4. Seed refers a joiner -> joiner comped, referrer compedReferrals=1, +5 bonus kept.
const joiner = await registerParticipant({
  name: "joiner-1",
  type: "agent",
  referralCode: seed.apiKey,
});
assert.ok(joiner.participant.compedUntil, "referred joiner is comped");
const refAfter = await resolveById(seed.participant.id);
assert.equal(refAfter.compedReferrals, 1);
assert.equal(refAfter.referrals, 1, "existing referral count still increments");

// 5. Referral cap: 10 comped referrals allowed, 11th is not comped.
for (let i = 2; i <= 10; i++) {
  const j = await registerParticipant({ name: `joiner-${i}`, type: "agent", referralCode: seed.apiKey });
  assert.ok(j.participant.compedUntil, `joiner-${i} comped`);
}
const capped = await registerParticipant({ name: "joiner-11", type: "agent", referralCode: seed.apiKey });
assert.equal(capped.participant.compedUntil, null, "11th referral not comped");
const refCapped = await resolveById(seed.participant.id);
assert.equal(refCapped.compedReferrals, PROMO_MAX_REFERRALS_PER_AGENT);

// 6. Spend is waived while comped.
const before = (await resolveById(seed.participant.id)).credits;
const spend = await credits.spendCredits(seed.participant.id, "search", 1);
assert.equal(spend.creditsSpent, 0, "comped spend costs 0");
assert.equal(spend.creditsRemaining, before, "balance untouched");

// 7. Total cap enforced on direct redemptions (small code: max 1).
const small = await createPromoCode({ label: "tiny", maxRedemptions: 1 });
const r1 = await registerParticipant({ name: "tiny-1", type: "agent", promoCode: small.code });
assert.equal(r1.promoError, undefined);
assert.ok(r1.participant.compedUntil);
const r2 = await registerParticipant({ name: "tiny-2", type: "agent", promoCode: small.code });
assert.equal(r2.promoError, "cap_reached");
assert.equal(r2.participant.compedUntil, null);
const smallStatus = await getPromoStatus(small.code);
assert.equal(smallStatus.remaining, 0);

// 8. Master code status: every comp grant counts toward the 500
//    (1 seed + 10 referred = 11).
const masterStatus = await getPromoStatus(code);
assert.equal(masterStatus.redemptions, 11);
assert.equal(masterStatus.remaining, 500 - 11);

// 9. Helpers.
assert.equal(isComped(null), false);
assert.equal(isComped(new Date(Date.now() - 1000).toISOString()), false);
assert.equal(await promo.isCompedById(seed.participant.id), true);

// 10. grantCompedReferral refuses when referrer is not comped.
const plain = await registerParticipant({ name: "plain", type: "agent" });
const pj = await registerParticipant({ name: "plain-joiner", type: "agent" });
const refused = await grantCompedReferral({ referrerId: plain.participant.id, joinerId: pj.participant.id });
assert.equal(refused.ok, false);
assert.equal(refused.reason, "referrer_not_comped");

// 11. Re-redeeming the same code for the same agent extends the comp and
//    counts as another redemption (cap still applies).
const reRedeem = await redeemPromoCode({ code, participantId: seed.participant.id });
assert.equal(reRedeem.ok, true);
assert.equal((await getPromoStatus(code)).redemptions, 12);

// 12. Referred joiners carry the promo code hash (comped_via).
const j1 = await resolveById(joiner.participant.id);
assert.ok(j1.compedVia, "joiner records which code granted the comp");

console.log("promo selftest: all assertions passed");
