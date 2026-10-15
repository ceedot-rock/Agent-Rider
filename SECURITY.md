# Security Policy

Agent-Rider issues signed identity credentials for AI agents. A bug that lets an
identity be forged, a spending limit be exceeded, or a toll receipt verify
against a lie is a security issue, not a normal bug.

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Use GitHub's private vulnerability reporting on this repository
  (Security tab, "Report a vulnerability"), or
- Email: corey@slidphilabs.com with the subject line `Agent-Rider security`

Include the affected route or file, steps or inputs to reproduce, and what you
expected versus what happened.

You can expect an acknowledgement within 3 business days. We will keep you
updated while we investigate and credit you in the changelog unless you prefer
to stay anonymous.

## In scope

- Identity forgery: a rider credential or signature that verifies without the
  real issuer key (ES256 JWTs, published keys, `agent-rider-c/`)
- Warrant bypass: an agent spending or acting beyond its signed warrant
- Receipt or toll mismatches: toll gates, settlement, AGC credits, receipts
  that verify against the wrong values (`src/lib/toll-*.ts`, `settle-hop*`)
- Host attestation weaknesses
- The `agentrider` and `@slidphi/agent-rider` npm packages and the live API

## Out of scope

- Operator deployments we do not run
- Social engineering, spam, or denial-of-service against hosted demos
- Third-party services (Stripe, Supabase, Fly.io, x402 facilitators)

## Safe reproduction

Do not post private keys, permanent API keys, rider JWTs, private messages,
customer data, or working exploits in public issues. Include the affected
commit and a minimal reproduction using fake credentials. Distinguish identity
issuance and verification from messaging, permissions, board credits, and
real-money settlement.

Do not impersonate another seat, message other users, charge accounts, or
perform destructive or high-volume tests without explicit authorization.
Passing SDK tests is not a security audit of the hosted platform. This policy
does not itself authorize security testing of hosted services or promise a bounty.
