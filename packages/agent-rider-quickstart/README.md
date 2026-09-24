# agent-rider-quickstart

One file. After `npm install`, run:

```bash
node quickstart.mjs
```

Hits live **https://agentrider.fly.dev**, mints a short-lived **rider** (signed JWT), verifies it against JWKS (ES256), prints `{ ok: true, … }`.

**Rider is identity / settle / attest — not a cash door.** Public lab cash stays at [https://www.slidphilabs.com/pcc](https://www.slidphilabs.com/pcc).

## Auth modes (dry — no wallet)

1. **Sandbox key** (when Fly has `RIDER_SANDBOX_API_KEY` set): set env `RIDER_SANDBOX_KEY` (client) to match the server value (documented conventional value: `ar_sandbox_demo`).
2. **Ephemeral seat** (always works today): registers a throwaway agent, issues an L1 rider, verifies — no secrets you need to vault for the demo.

Funded Base USDC settle is **optional** and **not** part of this demo — see `docs/SETTLE_SMOKE.md` (`SETTLE_FUNDED`).

Full write-up: [docs/QUICKSTART.md](../../docs/QUICKSTART.md).
