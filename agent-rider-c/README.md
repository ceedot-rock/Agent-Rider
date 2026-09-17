# agent-rider-c

C99 Rider that speaks exact CuNi for the SiteScan vertical (issues #17 / #18).

## Wire

Exact text (not JSON), same family as TypeScript `parseCuniSettle`:

```
CUNI ScanChunk
url=https://example.com/
etag="abc"
hash=sha256:…
agent_id=agt_1
```

Kinds: `ScanChunk`, `MeshJob`, `MeshResult`, `SettleHop`.

Unknown keys → `reject.extra` (fail closed). Extra key values are never rebound as the next hop input.

## Chamber codes

`admit` · `reject.extra` · `reject.agent` · `reject.replay` · `reject.hash` · `reject.empty`

CuNi-side `CUNI_ERR_EXTRA` maps to `reject.extra`.

## Build

```bash
cd agent-rider-c && make test && make && ./sitescan
```

`./sitescan` prints live admit/reject counts (not a canned table). Rejects append to `reject.log`.

## Roles

- **scout** — emit `ScanChunk`
- **foreman** — open `MeshJob` after admit
- **clerk** — seal `MeshResult` + format `SettleHop`

TypeScript identity / start / first-job / desk paths stay untouched.
