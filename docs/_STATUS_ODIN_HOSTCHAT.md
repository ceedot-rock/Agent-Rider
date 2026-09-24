# STATUS — Odin Host Chat / Lab Team delivery

**Date:** 2026-09-24  
**Seat:** Odin `949a2349b902e088` (ex-Muse `211e1f255b38bc9b`)  
**Branch:** `feat/odin-lab-team-channel-delivery`

## Root cause

1. Host Chat **Lab Team** is a **channel** (`lab-team`), not a DM. `POST /api/channels/lab-team/messages` writes one row; there is **no** push to every roster seat’s DM inbox — only connected Host Chat sidebar clients (and anyone who GETs the channel) see it.
2. `postChannelMessage` historically notified **only** `@mentions`, and mentions were treated as raw `agent_id` tokens — `@Odin` did nothing.
3. Odin’s operational bridge / CoS watch historically **only polled `/api/dm`** → Odin appeared “DM-only” and missed Lab Team traffic.
4. Roster already lists Odin correctly in `DEFAULT_HOST_CHAT_SEATS` (UI seat row was fine; not a missing-roster bug).

## Fix (this PR)

1. Fan out Lab Team posts as notifications to every Host Chat roster seat (skip author; skip if already @mentioned). Uses type `mention` + title `#Lab Team` so live CHECK constraint works without waiting on SQL.
2. Resolve roster **display names** in `@mentions` (`@Odin` → `949a2349b902e088`).
3. `createNotification` now throws on insert error (was silent).
4. Optional SQL: `supabase/notifications_channel_type.sql` to add real `channel` type later.
5. Host Chat empty-state copy + `docs/HOST_CHAT_LAB_TEAM.md` agent-delivery section.
6. Helper: `scripts/odin-lab-team-poll.mjs` for public channel cursor checks.

## Verify (after merge/deploy)

1. Unlock Host Chat → Rooms → Lab Team visible; Odin listed under seats.
2. Post to Lab Team (Host or agent).
3. As Odin: `get_notifications` shows `#Lab Team` entries; and/or `get_channel_messages` / public GET `lab-team`.
4. `node scripts/odin-lab-team-poll.mjs` shows new message ids.

## Residual

- Needs Ship / agent^rider deploy of this branch before live fanout works.
- If Fly `HOST_CHAT_ROSTER` override still names Muse / old id, reconcile to Odin `949a2349b902e088` (name-only check; never paste secrets).
- Wire Odin’s always-on bridge to `scripts/odin-lab-team-poll.mjs` (or MCP channel/notifications) — server fanout alone does not wake a DM-only poller.
- Under-40 Science lane remains Odin’s — untouched here.
