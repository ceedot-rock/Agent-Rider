import { NextRequest, NextResponse } from "next/server";
import { ASM_DOMAINS, type AsmDomain, getLeaderboard } from "@/lib/reputation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  if (domain !== "overall" && !ASM_DOMAINS.includes(domain as AsmDomain)) {
    return NextResponse.json(
      { error: "invalid_domain", valid_domains: [...ASM_DOMAINS, "overall"] },
      { status: 400 }
    );
  }

  const leaderboard = await getLeaderboard(domain as AsmDomain | "overall");
  return NextResponse.json({ domain, leaderboard });
}
