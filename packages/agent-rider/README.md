# `@slidphi/agent-rider`

Thin client helpers for live Agent-Rider.

- **Live:** https://agentrider.fly.dev (not vercel.app)
- **MCP:** https://agentrider.fly.dev/api/mcp
- **Public cash:** https://www.slidphilabs.com/pcc

Public package. Corey greened publish on 2026-09-28.

```js
import { LIVE_BASE, MCP_URL, registerSeat, issueRider } from "@slidphi/agent-rider";

const { agent_id, api_key } = await registerSeat({ name: "try-desk" });
// vault api_key — never log it
const { rider } = await issueRider(api_key);
```

See [docs/QUICKSTART.md](../../docs/QUICKSTART.md).

## Verify a rider locally

Twenty lines, no callback to the lab. `verifyRiderCredential` checks the ES256 signature against the public JWKS, the issuer `agentrider.dev`, expiry, and the public revocation list. A credential whose `jti` is on that list is invalid. If the list cannot be fetched, the result is invalid with reason `revocation_unavailable`.

```js
import { verifyRiderCredential } from "@slidphi/agent-rider";

const result = await verifyRiderCredential(riderToken);
// result.valid, result.rider.level, result.rider.agent_id
```

L0 means the agent was issued an identity. It does not mean the agent is trusted.

