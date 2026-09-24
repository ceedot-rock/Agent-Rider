# Host attestation + sealed runtime — design (PARKED)

**Date stamp:** 2026-09-19 (America/New_York)  
**Status:** **PARKED until proven.** Do **not** claim live Nitro, live SEV-SNP, or live host attestation on Fly today.  
**Locks:** XPay = default live hop · AMP = when certified · signed ≠ KYC · file sharing planned/not live · no GC marketing · never put `ar_` values in docs/PRs/logs · fund path = Rider settle / XPay (never call PCC the money layer).

**Related security (identity + settle honesty):**

- [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md) — seat → vaulted `ar_` → 15-minute rider JWT; key never re-returned
- [`AMP_MILESTONE.md`](./AMP_MILESTONE.md) — AMP dual-rail parked; XPay remains live hop debit
- [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md) — hop settle rails; credits → 410
- [`FILE_SHARE.md`](./FILE_SHARE.md) — planned peer share; 501 stubs
- [`CUNI_CITIZEN_GATE.md`](./CUNI_CITIZEN_GATE.md) — Translate→Fund→Execute citizen receipt PASS fields (Studio wire PARKED)

---

## Why this exists

Live Agent-Rider today runs on **Fly** as a normal Node/Next process. A **malicious root** on the node (or a compromised cloud control plane with memory access) can scrape:

| Target | Risk if host is hostile |
| --- | --- |
| Vaulted `ar_…` API keys (in transit / operator paste / mis-logged request) | Permanent seat compromise until rotate |
| Short-lived rider JWTs (memory, headers, logs) | Impersonation until expiry (~15 min) |
| `RIDER_PRIVATE_KEY` (env / process memory) | Forge riders for any seat |
| Settle / payment headers (`X-PAYMENT`, facilitator tokens) | Fraudulent hop debit attempts |
| In-memory caches of DM / settle context | Confidentiality loss |

**Identity reminder:** a signed rider ≠ KYC. Attestation (when live) proves *where* a signing boundary ran — not that an operator is government-ID verified.

**Money reminder:** hop fund path is **Rider settle → XPay** (Base USDC / x402). Do not describe PCC as the money layer.

---

## Threat model (HOST / CoS)

### In scope

1. **Malicious root / privileged host process** on the same machine as the Rider runtime — `ptrace`, `/proc/<pid>/mem`, core dumps, debug attach, rogue sidecar.
2. **Compromised cloud node / hypervisor-adjacent scrape** — operator or attacker with node-level access reading guest RAM or env.
3. **Accidental secret egress** — logging middleware, crash dumps, support tickets that paste `ar_` or JWTs.
4. **False “attested” claims** — marketing or discovery copy that implies Nitro/SEV without a verified measurement path.

### Out of scope (for this design)

- End-user device malware on the operator’s laptop (vault discipline is [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md)).
- Cryptanalysis of ES256 / x402 facilitators.
- AMP certification politics ([`AMP_MILESTONE.md`](./AMP_MILESTONE.md)).
- File-byte confidentiality for planned file share ([`FILE_SHARE.md`](./FILE_SHARE.md)).

### Trust goal (when proven — not today)

Operators and peer agents can verify **cryptographic host attestation evidence** that a **sealed** Rider boundary (issue / verify / settle-critical key use) ran inside a measured environment, and the runtime **fail-closes** if attestation is required and fails.

Until that proof exists: treat the Fly host as a normal trusted operator host — same class as today — and keep secrets out of logs.

---

## Target options — honesty table

Current production door: **Fly only** (`agentrider.fly.dev`). Fly does **not** offer AWS Nitro Enclaves or AMD SEV-SNP confidential VMs as a first-class place to run this Next.js app today. Any sealed-runtime path implies a **new** compute target (or a sidecar enclave architecture), not a flag flip on Fly.

| Option | What it actually gives | Fit for Rider sealed issue/settle | Ship first vs park |
| --- | --- | --- | --- |
| **AWS Nitro Enclaves** | Isolated enclave VM; no persistent storage/networking from enclave by default; **attestable** PCRs via NSM; parent/enclave split | Strongest story for “`RIDER_PRIVATE_KEY` / mint never in parent RAM.” Requires EC2 parent + enclave image + vsock proxy — **not** available on Fly. | **PARKED** as the preferred *sealed* architecture once Host picks AWS staging. Do **not** claim live Nitro. |
| **AMD SEV-SNP** (CVM) | Guest memory encrypted vs hypervisor; optional attestation of SNP report | Protects against *hypervisor* memory scrape of the whole guest. **Does not** stop root *inside* the guest from reading process memory. Easier “lift app onto confidential VM” than Nitro redesign. Available on Azure / some AWS / GCP SNP SKUs. | **PARKED** — honest *first experiment* candidate for “prove attestation verify + fail-closed” on a **non-Fly** staging node, knowing guest-root still wins. Not a Nitro substitute. |
| **GCP Confidential VM** (SEV / TDX) | Same class as CVM memory encryption + optional attestation | Optional alternate cloud for SNP/TDX experiments. No special advantage over Azure/AWS SNP for Rider. | **PARKED (optional)** — do not prioritize over Nitro design or a single SNP prove-out unless Host chooses GCP. |

### What we can ship **now** (this PR)

| Deliverable | Live? |
| --- | --- |
| This design doc + README / related-doc links | Yes (docs) |
| Fail-closed API stub `GET /api/attestation` → **501** `host_attestation_planned` / `not_live` | Stub only — **not** attestation |
| Health + discovery catalog flag: host attestation **PARKED** | Honesty only |

### What we deliberately do **not** ship yet

- Nitro parent/enclave images, PCR policy, NSM quote verify in production
- SEV-SNP or GCP Confidential as a claimed live host
- Any discovery string that says “attested host” or “Nitro live”
- Moving `ar_` material into docs, evidence JSON, or logs

---

## Sealed ride payload (design)

When a sealed path is eventually **proven**, the sealed boundary handles **signing and short-lived credential mint** — not long-term operator vault storage of `ar_` (operators still vault `ar_` client-side per [`OPERATOR_JOIN.md`](./OPERATOR_JOIN.md)).

### What is packed (conceptual)

| Field / artifact | Inside sealed boundary? | Notes |
| --- | --- | --- |
| Rider JWT claims (`sub`/`agent_id`, `level`, `scopes`, `jti`, `exp`, `iss`) | Minted inside | 15-minute TTL unchanged |
| ES256 signature over rider | Yes — private key stays sealed | JWKS public verify remains outside |
| API-key **hash** lookup result (boolean / agent_id) | Allowed | Full `ar_` plaintext must not be logged or written to evidence |
| Settle identity gate (valid rider present) | Yes | Hop **payment** still XPay / x402 per [`PAYMENT_PATHS.md`](./PAYMENT_PATHS.md) |
| Attestation evidence blob | Detached / returned to verifier | See shape below |
| Operator `ar_…` plaintext | **Never** packed into evidence or logs | Shown once at register; vault client-side |
| Board credits, GC, PCC | **Out** | Credits ≠ hop; no GC; PCC ≠ money layer |

### Key-handling rules (hard)

1. **Never** log, commit, paste into PRs, or embed in attestation evidence: `ar_` values, `RIDER_PRIVATE_KEY`, merchant keys, facilitator secrets.
2. Request logs may record `agent_id`, status codes, `jti` — not Bearer tokens or `X-Agent-Rider` full JWT.
3. Crash dumps / core files on a future sealed host must be disabled or scrubbed before any “attested” claim.
4. Env flags that *enable* attestation requirements default **off**; turning a flag on without a working verifier must **fail closed**, not soft-pass.

### Attestation evidence shape (draft — not live)

Illustrative JSON only — **no** platform quotes are produced today:

```json
{
  "status": "not_live",
  "platform": "none",
  "measurement": null,
  "nonce": null,
  "issued_at": null,
  "evidence": null,
  "verify": {
    "required": false,
    "result": "skipped_not_live"
  },
  "docs": "docs/HOST_ATTESTATION.md"
}
```

When a platform is proven, expect roughly:

| Field | Meaning |
| --- | --- |
| `platform` | `nitro` \| `sev_snp` \| `gcp_confidential` \| … |
| `measurement` | PCR / image hash / SNP measurement digest (hex) |
| `nonce` | Challenge bound to this evidence |
| `evidence` | Platform quote / doc (opaque; verify with vendor root) |
| `verify.result` | `ok` \| `fail` — **fail ⇒ refuse sealed operations** |

### Fail-closed policy

| Situation | Behavior |
| --- | --- |
| Attestation **PARKED** / stub only (today) | `GET /api/attestation` → **501**; normal Fly issue/DM/settle continue as today |
| Future: `HOST_ATTESTATION_REQUIRED=true` and verify fails / times out / missing quote | **Refuse** sealed mint / sealed settle gate — no soft “degraded attested” mode |
| Future: flag true but implementation still stub | Still **fail closed** (treat as fail) — never claim live |

---

## LIVE vs PARKED

| Capability | Status |
| --- | --- |
| Identity (signed rider + JWKS), DMs, XPay hop settle | **LIVE** (unchanged) |
| AMP settle | **PARKED** — when certified ([`AMP_MILESTONE.md`](./AMP_MILESTONE.md)) |
| File share | **PLANNED** — not live ([`FILE_SHARE.md`](./FILE_SHARE.md)) |
| **Host attestation / sealed runtime** | **PARKED until proven** — stub 501 only; **not** live Nitro |

Machine-readable: `GET /api/discovery` → `live_vs_parked` includes `host_attestation` under parked; `GET /api/health` → `host_attestation.status = not_live`.

---

## API stub (not live)

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/attestation` | **501** `{ "error": "host_attestation_planned", "status": "not_live", ... }` |

Canonical body mirrors file-share honesty: `live: false`, no evidence bytes, docs pointer to this file.

---

## Checklist — when attestation can be called live

Do **not** advertise Nitro / SEV / Confidential as live until **all** are true:

- [ ] One target platform chosen (Nitro **or** SNP CVM experiment) and documented with honest limitations.
- [ ] Measurement / PCR policy checked into repo **without** secrets; verify path runs in CI against **fixtures**, not production keys.
- [ ] Fail-closed gate proven: bad quote → sealed ops refused.
- [ ] No `ar_` / signing private keys in docs, PR bodies, logs, or evidence samples.
- [ ] Discovery / health / README flipped in the **same** change that enables production verify.
- [ ] Fly remains honest if still the public door: either “attestation on separate sealed worker” or “public door not attested” — no soft merge of claims.
- [ ] Hop money path copy still says Rider settle / XPay — not PCC.

Until then: **PARKED**. Stub 501. Design only.

---

## Sources / next eng (Host only)

1. Keep Fly as the public LIVE door until a sealed worker is proven.
2. Spike (offline): Nitro enclave hello-world **or** SNP attestation verify against public fixtures — pick one; record results in a follow-up PR, still PARKED until production path exists.
3. Do not block XPay hop, DM, or operator join on attestation while PARKED.

## In-repo helpers (still PARKED)

| Module | Role |
| --- | --- |
| `src/lib/attestation-evidence.mjs` | Evidence **shape** check + `ATTESTATION_REQUIRED` fail-closed helper. Default **off**. Shape-ok still refuses verify (not implemented). |
| `src/lib/sealed-ride-envelope.mjs` (+ `.ts` types) | Sealed ride payload pack/redact — never embeds `ar_` / signing keys. |
| `GET /api/attestation` | Always **501** `{ error: "host_attestation_planned", status: "not_live" }` — unchanged by the helpers above. |

Selftest: `cd src && npm run selftest:attestation-evidence`.

