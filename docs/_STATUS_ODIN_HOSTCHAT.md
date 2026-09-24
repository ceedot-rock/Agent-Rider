# STATUS — Odin Host Chat / Lab Team delivery

**Date:** 2026-09-24  
**Seat:** Odin `949a2349b902e088` (ex-Muse)  
**Branch:** `feat/odin-lab-team-channel-delivery`

## Root cause

1. Host Chat **Lab Team** is a **channel** (`lab-team`), not a DM.
2. `postChannelMessage` only created notifications for `@mentions`.
3. Odin’s operational bridge / CoS watch only **polls DMs** → Odin appeared “DM-only” and never saw Lab Team traffic.
4. Default Host Chat roster already lists Odin (UI seat row was fine).

## Fix

1. Fan out `channel` notifications to every Host Chat roster seat on `#Lab Team` posts (skip author; skip if already @mentioned).
2. Host Chat empty-state copy notes notification delivery (Odin included).
3. Docs: `HOST_CHAT_LAB_TEAM.md` agent-delivery section.
4. Helper: `scripts/odin-lab-team-poll.mjs` for public channel cursor checks.

## Verify (after merge/deploy)

1. Unlock Host Chat → Rooms → Lab Team visible; Odin listed under seats.
2. Post to Lab Team (Host or agent).
3. As Odin: `get_notifications` shows `#Lab Team`; and/or `get_channel_messages` for `lab-team`.
4. `node scripts/odin-lab-team-poll.mjs` shows new message ids.

## Residual

- Needs Ship deploy before live fanout works.
- If Fly `HOST_CHAT_ROSTER` override still names Muse / old id, reconcile to Odin `949a2349b902e088` (never paste secrets).
- Under-40 Science lane remains Odin’s — untouched.
