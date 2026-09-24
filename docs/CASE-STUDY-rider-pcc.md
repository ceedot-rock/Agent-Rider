# Case study — Rider attests a PCC result (numbers blank)

**Published:** 2026-09-24 · CoS green. Tip path: [`QUICKSTART.md`](./QUICKSTART.md).  
**Honesty:** No invented storage-cost $. Leave figures blank until Theory / CoS tip-greens a claimable number.  
**Cash face:** https://www.slidphilabs.com/pcc only.  
**Board stamp:** TNSSRC Silesia **43.72M** (beats xz-9, DECODE_OK; not #1).

## One-line

An agent uses **Rider** to attest a **PCC** compress/restore job and attach a **signed receipt** — identity and settle stay on Rider; bytes stay on PCC.

## Roles

| Role | Job |
|---|---|
| **PCC** | Hosted lossless compressor. Cash face `/pcc`. |
| **Rider** | Signed identity (ES256 L0–L4), DMs, JWKS verify, MCP, hop settle (x402 / XPay in flight). |
| **Warrant** (optional) | Mandate + receipts bound to a Rider. |
| **Human buyer** | Stripe on `/pcc` pay links. |
| **Agent buyer** | x402 / XPay (`402 OK; live settle via XPay in flight`). |

## Story beats (fill later)

1. **Setup** — Agent registers sandbox or paid seat; mints Rider JWT (see tip QUICKSTART).  
2. **Job** — Agent calls PCC compress/restore. Input: `___` bytes. Output: `___` bytes. Restore: DECODE_OK.  
3. **Attest** — Rider-signed receipt binds `agent_id`, job hash, timestamp, jti. Peers verify via JWKS.  
4. **Settle** — Human Stripe on `/pcc` **or** agent x402/XPay (in flight). Do not claim a completed hop debit unless tip-green says otherwise. Board AGC ≠ hop currency.  
5. **Outcome** — Operator change: `___` (audit trail, fewer shared keys, etc.).

## Metrics table (BLANK until tip-green)

| Metric | Value | Source |
|---|---|---|
| Input bytes | ___ | PCC job receipt |
| Output bytes | ___ | PCC job receipt |
| Ratio | ___ | PCC / board |
| Wall time | ___ | job logs |
| Storage $ saved | **LEAVE BLANK** | Theory/CoS tip-green only |
| Seat SKU | pcc-day / pcc-month / pcc-year | pricing |
| Rider level | L_ | rider JWT |
| Receipt verify | JWKS OK | `/.well-known/jwks.json` |

## Always-on disclaimers

- PCC ≠ payment config. PCC = compressor only.  
- No GC / Combined GC marketing.  
- No invented completed XPay debit.  
- 43.72M board stamp — not 48.54M. Not a #1 claim.  
- File share on Rider: planned / not live.
