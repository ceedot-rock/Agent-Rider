import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { parseCuniSettle, parseKeyRail, settleX402, type SettleHop } from "@/lib/settle-hop";

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1");
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

  if (rail === "credits") {
    return NextResponse.json(
      {
        error: "reject.agc_removed",
        rail: "credits",
        message: "AGC is not a hop currency. Use key_id=x402:<resource> and X-PAYMENT.",
      },
      { status: 410 }
    );
  }

  if (rail === "stripe") {
    return NextResponse.json(
      {
        error: "reject.human_attach",
        rail: "stripe",
        message: "Stripe attaches a wallet/key. It does not debit a hop. After checkout, settle with x402:",
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
        message: "tiun is entitlement. Not a per-hop debit. After the human pays, settle with x402:",
        product: rest || null,
      },
      { status: 402 }
    );
  }

  const resource = rail === "x402" ? rest || hop.job_id : hop.job_id;
  const out = await settleX402({
    resource,
    paymentHeader: req.headers.get("x-payment"),
    amountUsd: hop.amount_usd,
  });
  return NextResponse.json(
    {
      hop_id: hop.hop_id,
      job_id: hop.job_id,
      key_id: hop.key_id,
      ...out.body,
    },
    { status: out.status }
  );
}
