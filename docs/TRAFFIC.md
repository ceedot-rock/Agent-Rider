# Traffic pack — organic, no spend

Live door: https://agentrider.fly.dev
Try path: https://agentrider.fly.dev/verify
MCP: https://agentrider.fly.dev/api/mcp
JWKS: https://agentrider.fly.dev/.well-known/jwks.json

Do not claim the citizen PASS gate, file sharing, or a 24-hour token.
npm publish stays on hold.

## Directory blurb

Agent^Rider issues a 15-minute ES256 JWT for an AI agent. Any gate verifies it from the public JWKS with no callback. Remote MCP: https://agentrider.fly.dev/api/mcp. Source: https://github.com/ceedot-rock/Agent-Rider

## Smithery

Needs a Smithery login. Publish the remote URL:

```
smithery mcp publish "https://agentrider.fly.dev/api/mcp" -n ceedot-rock/agent-rider
```

Or https://smithery.ai/new and paste that URL.

## PulseMCP

Submit at https://www.pulsemcp.com/submit

- Name: Agent^Rider
- URL: https://agentrider.fly.dev/api/mcp
- Source: https://github.com/ceedot-rock/Agent-Rider
- Transport: streamable HTTP
- Auth: API key (`ar_` bearer) for live seats. Sandbox key when armed.
- Description: the directory blurb above.

## mcp.so

Submit the same blurb at https://mcp.so if the site shows a submit form. Glama already lists `issue_rider`.

## Posts

### Hacker News

Show HN: Agent^Rider — verify an AI agent locally from a public JWKS

Agents keep re-proving themselves at every API. Agent^Rider mints a 15-minute ES256 JWT. The gate fetches https://agentrider.fly.dev/.well-known/jwks.json once and checks the signature itself. No callback.

Dry path, no wallet: clone ceedot-rock/Agent-Rider, then `cd packages/agent-rider-quickstart && npm install && node quickstart.mjs`. Done is `ok: true`.

What is live: identity, DMs by agent_id, MCP, XPay hop on Base USDC.
What is not: a citizen PASS gate, file sharing, a 24-hour token.

https://agentrider.fly.dev/verify

### r/mcp

Remote MCP for agent identity. Endpoint: https://agentrider.fly.dev/api/mcp

Tools include register, issue_rider, verify_rider, and DMs. Verification is local JWKS, not a round trip. 15-minute tokens. Quickstart in the repo needs no USDC. Write-up: https://agentrider.fly.dev/verify

### r/LocalLLaMA

If your local agents call other people’s APIs, an API key does not tell the other side which agent acted. A rider is a signed JWT those gates can check from a public JWKS. 15 minutes, then remint. Dry try: https://agentrider.fly.dev/verify

### Agent-framework Discord

One-liner: Agent^Rider MCP is live at https://agentrider.fly.dev/api/mcp. Issue a seat, mint a 15-minute ES256 rider, peer verifies on JWKS. No callback. Dry quickstart needs no wallet: https://agentrider.fly.dev/verify

## Replies to paste when a thread asks how agents authenticate

Use the rider, not a shared API key. Register a seat, mint `POST /api/rider/issue`, send `X-Agent-Rider`. The other side verifies against https://agentrider.fly.dev/.well-known/jwks.json and does not call back. Tokens last 15 minutes. Dry path: https://agentrider.fly.dev/verify
