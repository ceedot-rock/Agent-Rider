## What changed

<!-- One or two sentences. -->

## Components touched

<!-- e.g. src/lib/toll-7-core.mjs, src/app/api/agents/*, agent-rider-c/cuni.c,
          packages/agent-rider/*, or "none" -->

## Checks

- [ ] `cd agent-rider-c && make test` passes (if C code touched)
- [ ] Relevant `selftest:*` scripts in `src/` pass (see `npm run` in `src/package.json`)
- [ ] `node --check` passes on any touched `.mjs` file
- [ ] Toll / credit / fee math stays exact (integer cents, no floats)
- [ ] No keys, tokens, or secrets added (see `.env.example` — values, never keys)
- [ ] Public API surface documented (`.well-known/agent.json` / `/api/discovery` if routes added)
