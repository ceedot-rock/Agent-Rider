import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { getTransactionHistory } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const gate = await checkGate(req, "L1");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const transactions = await getTransactionHistory(gate.rider.agent_id, limit);
  return NextResponse.json({ id: gate.rider.agent_id, transactions, total: transactions.length });
}
