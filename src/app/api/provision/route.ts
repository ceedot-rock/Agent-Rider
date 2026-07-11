import { NextRequest, NextResponse } from "next/server";
import { retrieveSession } from "@/lib/stripe";

function generateMerchantKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rider_live_${hex}`;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  try {
    const session = await retrieveSession(sessionId);
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return NextResponse.json({ error: "Session not completed" }, { status: 402 });
    }

    const merchantKey = generateMerchantKey();

    return NextResponse.json({
      merchantKey,
      customerEmail: session.customer_details?.email ?? null,
      subscriptionId: session.subscription?.id ?? session.subscription ?? null,
    });
  } catch (err: any) {
    console.error("provision error", err);
    return NextResponse.json({ error: err?.message || "Provisioning failed" }, { status: 500 });
  }
}
