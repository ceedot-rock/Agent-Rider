# `@slidphi/agent-rider`

Thin client helpers for live Agent-Rider.

- **Live:** https://agentrider.fly.dev (not vercel.app)
- **MCP:** https://agentrider.fly.dev/api/mcp
- **Public cash:** https://www.slidphilabs.com/pcc

`private: true` — **HOLD** public npm publish until CoS-green. Git surface only.

```js
import { LIVE_BASE, MCP_URL, registerSeat, issueRider } from "@slidphi/agent-rider";

const { agent_id, api_key } = await registerSeat({ name: "try-desk" });
// vault api_key — never log it
const { rider } = await issueRider(api_key);
```

See [docs/QUICKSTART.md](../../docs/QUICKSTART.md).
