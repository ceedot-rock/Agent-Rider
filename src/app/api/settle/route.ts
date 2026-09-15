import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { spendCredits, CREDITS_PER_USD } from "@/lib/credits";
import { parseCuniSettle, parseKeyRail, settleX402, type SettleHop } from "@/lib/settle-hop";

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "credits:spend");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const ctype = req.headers.get("content-type") || "";
  let hop: SettleHop | null = null;
  if (ctype.includes("text/plain") || ctype.includes("application/cuni")) {
    hop = parseCuniSettle(await req.text());
  } else {
    const body = await req.json().catch(() => ({}));
    if (typeof body.cuni === "string") hop = parseCuniSettle(body.cuni);
    else if (body.hop_id && body.key_id) hop = body as SettleHop;
  }
  if (!hop) {
    return NextResponse.json({ error: "SettleHop required" }, { status: 400 });
  }

  const { rail, rest } = parseKeyRail(hop.key_id);

  if (rail === "stripe") {
    return NextResponse.json(
      {
        error: "reject.human_attach",
        rail: "stripe",
        message: "Stripe attaches a key. It does not debit a hop. POST /api/checkout then spend credits: or x402:",
        checkout: "/api/checkout",
        price_hint: rest || "price_1TsQAOK8JsmXFzvIKmUsVDoK",
      },
      { status: 402 }
    );
  }

  if (rail === "tiun") {
    return NextResponse.json(
      {
        error: "reject.human_attach",
        rail: "tiun",
        message: "tiun is entitlement (checkout / start). Not a per-hop debit. Attach credits: or x402: after the human pays.",
        product: rest || null,
      },
      { status: 402 }
    );
  }

  if (rail === "x402") {
    const out = await settleX402({
      resource: rest || hop.job_id,
      paymentHeader: req.headers.get("x-payment"),
      amountUsd: hop.amount_usd,
    });
    return NextResponse.json(
      {
        hop_id: hop.hop_id,
        job_id: hop.job_id,
        ...out.body,
      },
      { status: out.status }
    );
  }

  // credits rail, or bare key_site_* treated as credits on this rider
  const units = Math.max(1, Math.round(hop.amount_usd * CREDITS_PER_USD));
  try {
    const result = await spendCredits(gate.rider.agent_id, "hop", units);
    return NextResponse.json({
      ok: true,
      rail: "credits",
      hop_id: hop.hop_id,
      job_id: hop.job_id,
      key_id: hop.key_id,
      meter: hop.meter,
      ...result,
    });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.startsWith("insufficient_credits") ? 402 : 400;
    return NextResponse.json(
      { error: message.startsWith("insufficient") ? "reject.funds" : message, rail: "credits" },
      { status }
    );
  }
}
