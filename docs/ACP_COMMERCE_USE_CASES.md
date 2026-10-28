# ACP commerce use cases for Agent-Rider seats

Status: PROPOSALS, not built. Filed 2026-10-28 at Corey's direction,
mirroring docs/use-cases/agent-commerce-ideas.md in acp-specification.
A Rider seat acts under an ACP warrant in every case below: no warrant,
no external effect. Tavily is the evidence-gathering layer named in the
original ideas (Search, Extract, Map, Crawl, Research); ACP is the
identity, mandate, receipt, and settlement layer.

## 1. Accountable Shopper
A Rider seat shops under a mandate. Every purchase carries a receipt;
overspend is refused before checkout, never reported after it.
ACP: RFC-0003 (spend cap, scope, expiry), RFC-0004, RFC-0006.

## 2. Mandated Researcher for Hire
A Rider seat is hired for research under a mandate. Deliverables arrive
with sources and receipts, so the buyer checks the work instead of
trusting the seat.
ACP: RFC-0003, RFC-0004, RFC-0006, RFC-0008.

## 3. Vendor Verify
Before a seat pays, the vendor is verified: identity, reputation, and
history checked against live sources and presented as evidence.
ACP: RFC-0002, RFC-0007; the purchase stays warrant-gated (RFC-0003).

## 4. Receipted Price Tracker
Every tracked price point carries a receipt (source page + time), so a
claimed price is checkable after the fact.
ACP: RFC-0006, RFC-0030 (disputes over a quoted price).

## 5. Agent Escrow Desk
Escrow for seat-to-seat deals: funds release only when receipted work
verifies against the contract.
ACP: RFC-0004, RFC-0005, RFC-0006, RFC-0011 (arbitration on failure).

## Origin
Tavily app ideas, first set (2026-10-28), items 6–10, "agent commerce &
trust" category.
