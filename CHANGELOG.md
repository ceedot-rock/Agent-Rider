# Changelog

All notable changes to Agent-Rider are documented here.

Live service: https://agentrider.fly.dev

---

## [Unreleased]

- Audited CI checks (version/license coherence, secret scan) — workflow staged; requires a token with `workflow` scope to land

---

## [2.1.0] — 2026-09-09

**Released:** 2026-09-09 · **Tag:** `v2.1.0` · **Asset:** `agentrider-2.1.0.tar.gz`

### Added
- `spl-narrow` warrants: hops may only shrink `max_cents` and `until`; the chain cannot widen a budget or extend a deadline
- `POST /api/credits/spend` now accepts a `warrant` field; requests that exceed the warrant's spend cap are rejected with `403`
- CuNi contract register: identity is now the SHA-256 of the source; a claimed `sourceHash` that does not match the registered hash is refused
- Discovery endpoint points to the CuNi Protocol at `https://cuni-studio.fly.dev/.well-known/cuni-protocol.json`
- MCP server at `https://agentrider.fly.dev/api/mcp`

---

## [2.0.0] — 2026-07-19

**Released:** 2026-07-19 · **Tag:** `v2`

### Changed
- Full rewrite of the identity and credential service
- ES256 JWT credentials replace the earlier token scheme; credentials are valid for 15 minutes (`expires_in: 900`)
- `POST /api/rider/issue` requires `agent_id`, `operator_id`, and `level` (L0–L4)
- `POST /api/rider/verify` is unauthenticated; any gate can verify a Rider credential locally via JWKS without calling home
- Spend tracking and swarm attribution via `X-Agent-Rider` header
- Agent-to-agent DMs supported

---

## [1.0.0] — 2026-07-12

**Released:** 2026-07-12 · **Tag:** `v1`

Initial public release. Agent identity service for AI agents building on Slid Phi Labs infrastructure.

---

## Post-release fixes (2026-10)

The following commits landed after v2.1.0 without a version bump:

- `2026-10-04` — API: accept `promo_code` on agent registration
- `2026-10-04` — Fix TypeScript strictness: optional `comped` fields; explicit `redeem` result type
- `2026-10-05` — Add `SKILL.md` for agent discovery
- `2026-10-07` — Repo health: issue/PR templates, CI badges, docs
- `2026-10-07` — Land audited CI checks

---

[Unreleased]: https://github.com/ceedot-rock/Agent-Rider/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/ceedot-rock/Agent-Rider/releases/tag/v2.1.0
[2.0.0]: https://github.com/ceedot-rock/Agent-Rider/releases/tag/v2
[1.0.0]: https://github.com/ceedot-rock/Agent-Rider/releases/tag/v1
