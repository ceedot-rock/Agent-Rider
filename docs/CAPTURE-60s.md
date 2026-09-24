# 60s screen capture — Rider try pack (SCRIPT)

**Published:** 2026-09-24 · CoS green. Tip path: [`QUICKSTART.md`](./QUICKSTART.md).  
**Owner:** Docs pins clip in README + MCP docs after sandbox path is green.  
**If this seat cannot record:** run these steps on a machine that can; keep ≤60s.

## Title card (0–3s)

`Rider try — register → mint rider → MCP call → verify`  
Subtitle: `PCC = compressor (/pcc cash) · Rider = identity / DM / hop · board 43.72M`

## Script (≈57s)

| t | Action | On-screen |
|---|---|---|
| 0–8s | Open tip QUICKSTART; set `BASE=https://agentrider.fly.dev` | Show live host only (no vercel.app) |
| 8–18s | `POST /api/agents` sandbox register; vault `ar_` (mask key) | “Vault once — never re-shown” |
| 18–28s | `POST /api/rider/issue` → L1 JWT | `X-Agent-Rider` / `rider_token` |
| 28–42s | MCP client → `https://agentrider.fly.dev/api/mcp` · call `list_tasks` or `verify_trust` (unauth) then one auth tool e.g. `get_balance` | Streamable HTTP |
| 42–52s | Optional: show JWKS verify path `/.well-known/jwks.json` | peers verify locally |
| 52–60s | End card | Cash face **https://www.slidphilabs.com/pcc** · stamp **43.72M** · `402 OK; XPay hop in flight — do not invent debit` · AGC ≠ hop currency |

## Pin targets

- `Agent-Rider` README try section
- MCP docs / llms MCP blurb
- Optional site `/rider` Try deep link

## Status

**Published** 2026-09-24. Live 60s recording may still wait on a confirmable sandbox MCP key+flow green (or Docs records from tip register→issue→MCP without a special key). Prefer agent^rider green before pin.
