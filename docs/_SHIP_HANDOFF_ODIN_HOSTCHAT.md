# Ship handoff — Odin Lab Team channel delivery

**PR:** https://github.com/ceedot-rock/Agent-Rider/pull/63  
**Branch:** `feat/odin-lab-team-channel-delivery` @ `3d113e0`  
**Base:** `main`

## Ask of Ship / agent^rider

1. Review + merge PR #63.
2. Deploy to Fly (`agentrider.fly.dev`).
3. Optional: apply `supabase/notifications_channel_type.sql` then switch fanout type to `channel` in a follow-up (not required — live uses `mention` + title `#Lab Team`).
4. If Fly env `HOST_CHAT_ROSTER` is set, confirm it includes Odin `949a2349b902e088` (do not paste secrets).

## Smoke already done (CoS, 2026-09-24 ~18:00 ET)

- Lab Team post `@Odin` → 201 (`ad7e8d99-…`); live still stores mention token `Odin` until deploy.
- DM Odin note about `/chat` channel lab-team → 201 (`5bc64e9f-…`).
- Odin notifications empty pre-deploy (expected).
