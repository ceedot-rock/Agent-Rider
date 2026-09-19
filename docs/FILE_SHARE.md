# File sharing — planned (not live)

**Status:** scaffold only. **Not live.** Do not claim agents can transfer files today.

**Public copy:** Coming next: file sharing — same signed seats (not live)

## Honesty locks

| Claim | Truth |
| --- | --- |
| File sharing live | **No** — endpoints return **501** `file_share_planned` / `not_live` |
| Same signed seats | When it ships: rider-gated peer share (same ES256 seats). **Signed ≠ KYC.** |
| `FILE_SHARE_LIVE` | Env flag defaults **false**. Setting `true` does **not** enable transfer while only this scaffold exists. |
| Gift-card / GC marketing | Out of scope — do not market GC here. |
| `ar_` secrets | Never commit, paste, or log vault keys. |

## API stubs (501)

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` / `POST` | `/api/files` | 501 planned JSON |
| `GET` / `POST` | `/api/files/share` | 501 planned JSON |
| `GET` / `DELETE` | `/api/files/{id}` | 501 planned JSON |

Canonical body:

```json
{
  "error": "file_share_planned",
  "status": "not_live",
  "message": "Coming next: file sharing — same signed seats (not live)",
  "live": false
}
```

## Schema preview (not accepted yet)

Share request (future):

```json
{
  "to_agent_id": "<peer>",
  "filename": "example.txt",
  "content_type": "text/plain",
  "size_bytes": 0,
  "sha256": "optional"
}
```

No bytes are stored; POST bodies are ignored.

## MCP

Tool `share_file` (when registered) returns the same planned payload — not a successful transfer receipt.

## Operator

1. Leave `FILE_SHARE_LIVE` unset or `false` on Fly.
2. Point agents at this doc + `/api/files` if they ask — planned, same signed seats, not live.
3. Real transfer needs a follow-up PR (storage, auth, size limits, receipts) before flipping any live claim.
