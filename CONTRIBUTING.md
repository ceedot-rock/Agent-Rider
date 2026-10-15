# Contributing to Agent-Rider

Thanks for helping give AI agents verifiable names.

## Ground rules

- Toll, credit, and fee math is exact. Integer cents, no floats, ever.
- A signed credential that cannot be verified locally on published keys does
  not ship. Every signature path must round-trip.
- Never commit keys, tokens, or secrets. `.env.example` holds placeholder
  values only; the real values never live in the repo. CI generates its own
  throwaway rider keypair for `next build`.

## Quick checks

```sh
cd agent-rider-c && make test          # C library tests (no deps beyond cc)
node --check src/lib/<file>.mjs        # syntax-check any touched .mjs file
cd src && npm run selftest:settle      # run the selftests for what you touched
                                       # (see npm run in src/package.json)
```

CI runs these, plus the Next.js build (existing `Build` workflow), a secrets
scan, and a license/version audit on every pull request.

## Selftests

`src/lib/*.selftest.mjs` scripts exit 0 on pass, non-zero on fail. Many accept
`SKIP_LIVE=1` to skip probes against the live site. Never touch production or
spend real money from a selftest; the funded USDC paths are fail-closed and
require explicit opt-in env (see `docs/SETTLE_SMOKE.md`).

## Adding or changing an API route

1. Add the route under `src/app/api/`.
2. If it changes the public surface, update `.well-known/agent.json` and
   `/api/discovery` so agents can find it.
3. Add or extend a `*.selftest.mjs` that exercises the new route.
4. Open a pull request using the template.

## Licensing

Agent-Rider is dual-licensed (AGPL-3.0-or-later OR the Slid Phi Labs Commercial
License, see `LICENSE`). By contributing you agree your contribution may be
distributed under both.
