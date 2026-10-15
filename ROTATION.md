# Toll-Signer Key Rotation & Revocation — the published verifier contract

**Applies to:** every signed object the toll gates produce — v5 exactness
attestations, v4 grant envelopes, v3 escrow receipts, v6 bond receipts, v7
memory-export receipts, and `POST /api/toll/public/attest` envelopes.

## The keys

| Key | Signs | kid | Lives in JWKS |
|---|---|---|---|
| Rider identity key (`RIDER_PRIVATE_KEY`) | Rider JWTs only — never toll receipts | RFC 7638 thumbprint | Yes (backwards compat: receipts minted before the dedicated toll signer still verify) |
| Toll signer (`TOLL_SIGNING_KEY`) | All toll receipts | RFC 7638 thumbprint, distinct from the Rider kid | Yes |
| Previous toll signers | Nothing (grace-period verification only) | Their own thumbprints | Yes, while in grace |

Envelope shape is unchanged: `{payload, sig, kid, alg: "ES256"}`.

## The JWKS

`GET /.well-known/jwks.json` (Cache-Control: `public, max-age=3600, stale-while-revalidate=86400`):

```json
{
  "keys": [ { "kty": "EC", "crv": "P-256", "x": "…", "y": "…",
              "kid": "<rfc7638-thumbprint>", "alg": "ES256", "use": "sig" } ],
  "revoked": [ { "kid": "<thumbprint>", "revoked_at": "2026-10-08T13:00:00Z" } ]
}
```

- `keys` carries the Rider identity key, the current toll signer, and any
  previous toll signers still in their rotation grace period.
- `revoked` lists kids that MUST fail closed. Revoked kids stay listed —
  they are never silently dropped, so a verifier can always distinguish
  "revoked" from "unknown".

## What a verifier MUST do

1. Fetch the JWKS. **Cache it at most 1 hour** (honor our `max-age=3600`).
   A verifier that cannot fetch a fresh JWKS **must refuse** — never verify
   against a stale snapshot and call it good.
2. Look up the envelope's `kid` in the JWKS `revoked` list **first**.
   Hit → fail closed with code **`revoked_kid`**.
3. Look up the `kid` in `keys`. Miss → fail closed with code
   **`unknown_kid`**.
4. Verify the ES256 signature over the canonical payload. Failure → fail
   closed (`bad_signature` / `malformed_envelope`).
5. Every failure mode is a **named, recognizable code**. There is no silent
   pass: a verifier with a stale or revoked `kid` fails closed, loudly.

## Rotation procedure (operator runbook)

Performed rarely, manually, with the lab's key ceremony. No automation mints
or moves keys.

1. **Generate** a new ES256 P-256 keypair offline. Export the private half as
   PKCS8 PEM; keep it secret. Export the public half as a JWK
   (`{"kty":"EC","crv":"P-256","x":"…","y":"…"}`).
2. **Overlap:** set `TOLL_PREVIOUS_PUBLIC_JWKS` to a JSON array containing
   the OLD signer's public JWK, and set `TOLL_SIGNING_KEY` to the NEW
   private PEM. Deploy. The JWKS now serves old + new kids — **both verify**.
3. **Flip:** signing already uses the new key (step 2 did it atomically with
   the deploy). Confirm new receipts carry the new `kid`.
4. **Grace period:** keep the old kid trusted (recommendation: 7 days, long
   enough for the 1-hour verifier cache to turn over many times).
5. **Revoke:** add the old kid to `TOLL_REVOKED_KIDS`
   (`"<kid>:<ISO-8601-timestamp>"`, comma-separated for several), and remove
   it from `TOLL_PREVIOUS_PUBLIC_JWKS`. Deploy. Old receipts now fail closed
   with **`revoked_kid`** — recognizable, never a silent pass, and the kid
   stays listed in `revoked` permanently.

## Revocation (emergency)

Suspected compromise: skip the grace period. Add the kid to
`TOLL_REVOKED_KIDS` and deploy immediately. The revocation check runs
before key lookup, so a revoked kid fails closed even if its key is still
listed in `keys`.

## Configuration reference

| Variable | Format | Required |
|---|---|---|
| `TOLL_SIGNING_KEY` | ES256 P-256 PKCS8 PEM (private) | Yes — signing fails closed (500) without it; **no fallback to the Rider key, ever** |
| `TOLL_PREVIOUS_PUBLIC_JWKS` | JSON array of public JWKs (`kty`/`crv`/`x`/`y`) | No — only during rotation grace |
| `TOLL_REVOKED_KIDS` | `"kid:ISO-timestamp,kid:ISO-timestamp"` | No — empty means none revoked |
| `RIDER_PUBLIC_KEY` | ES256 SPKI PEM (public) | Yes — JWKS always serves the Rider key |

Malformed `TOLL_REVOKED_KIDS` or `TOLL_PREVIOUS_PUBLIC_JWKS` values throw at
startup/parse time — trust roots are never silently misread.

## The decisive test (for the skeptic)

> A verifier holding a pre-rotation JWKS snapshot, handed a receipt signed
> with the post-rotation key, MUST fail closed with `unknown_kid` — not
> pass, not error ambiguously. A verifier handed a receipt whose kid is in
> the `revoked` list MUST fail closed with `revoked_kid` — even if the key
> is still listed in `keys`.

Both behaviors are covered by `selftest:toll-rotation` (32 assertions) and
by the corruption sandbox (`sk_sandbox_demo`): submit a tampered `kid` and
watch the refusal codes.
