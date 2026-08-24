# LicenseBox — monthly payment check (Agent-Rider)

| State | Behavior |
|-------|----------|
| First open | 24h free trial |
| Payment check **succeeds** | Stays open until period end (~30d) |
| Payment check **fails** | Black box **shuts** |

```js
import { requireLicense, licenseMiddleware } from "../src/license-box.mjs";

// CLI / server boot
await requireLicense("agent-rider");

// Hosted MCP / API (real IP gate)
app.use("/api/mcp", licenseMiddleware("agent-rider"));
```

Env: `LICENSE_CHECK_URL`, `LICENSE_PAY_URL`, `LICENSE_HMAC_SECRET`
