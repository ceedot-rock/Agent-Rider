/**
 * Sealed ride envelope create → bind → verify selftest.
 * No network, no secrets. Run: cd src && npm run selftest:sealed-ride
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSealedRide,
  bindSealedRideSeat,
  verifySealedRideForExecute,
  isSealedRideRequired,
  serializeSealedRideEnvelope,
  redactForLog,
  isForbiddenEnvelopeFieldName,
} from "./sealed-ride-envelope.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- flag ---
assert.equal(isSealedRideRequired({}), false);
assert.equal(isSealedRideRequired({ SEALED_RIDE_REQUIRED: "1" }), true);
assert.equal(isSealedRideRequired({ SEALED_RIDE: "yes" }), true);

// --- create → bind → verify (flag on) ---
const created = createSealedRide({ purpose: "execute" });
assert.equal(created.v, 1);
assert.equal(created.seat_bound, false);
assert.ok(created.ride_id.startsWith("sr_"));
assert.equal(created.attestation.platform, "none");

assert.equal(verifySealedRideForExecute(created, {}).ok, true); // off = pass-through
assert.equal(verifySealedRideForExecute(created, {}).skipped, true);

{
  const unbound = verifySealedRideForExecute(created, { SEALED_RIDE_REQUIRED: "1" });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.body.error, "sealed_ride_unbound");
}

const bound = bindSealedRideSeat(created, { agent_id: "agent-abc", api_key_hash_ok: true });
assert.equal(bound.seat_bound, true);
assert.equal(bound.seat.agent_id, "agent-abc");
assert.equal(bound.api_key_hash_ok, true);

{
  const ok = verifySealedRideForExecute(bound, { SEALED_RIDE_REQUIRED: "1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.envelope.seat.agent_id, "agent-abc");
}

{
  const miss = verifySealedRideForExecute(null, { SEALED_RIDE_REQUIRED: "true" });
  assert.equal(miss.ok, false);
  assert.equal(miss.body.error, "sealed_ride_required");
}

// --- forbid secrets ---
assert.equal(isForbiddenEnvelopeFieldName("api_key"), true);
assert.equal(isForbiddenEnvelopeFieldName("purpose"), false);
assert.throws(() =>
  serializeSealedRideEnvelope({ v: 1, purpose: "sealed_preview", api_key: "x" })
);
assert.throws(() => bindSealedRideSeat(created, { agent_id: "ar_lookslikeakey12345678" }));

const redacted = redactForLog({ agent_id: "ok", token: "ar_ABCDEFGHijklmnop" });
assert.equal(redacted.token, "[REDACTED]");

assert.throws(() => bindSealedRideSeat(bound, { agent_id: "other" })); // already bound

// --- honesty ---
const src = readFileSync(join(__dirname, "sealed-ride-envelope.mjs"), "utf8");
assert.match(src, /SEALED_RIDE_REQUIRED/);
assert.match(src, /PARKED|not live/i);
assert.match(src, /createSealedRide/);
assert.match(src, /bindSealedRideSeat/);
assert.match(src, /verifySealedRideForExecute/);
assert.doesNotMatch(src, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(src, /Nitro is live|sealed runtime is live/i);

const ts = readFileSync(join(__dirname, "sealed-ride-envelope.ts"), "utf8");
assert.match(ts, /SealedRideEnvelope/);
assert.match(ts, /Never embed or log ar_/);
// Mentions in RULES comments are fine; fields must not appear as type members.
assert.doesNotMatch(ts, /\bkey_material\s*[?:]/);
assert.doesNotMatch(ts, /\bapi_key_plaintext\s*[?:]/);

console.log(
  "sealed-ride-envelope.selftest: ok (off pass-through; on unbound refuse; bind+verify accept)"
);
