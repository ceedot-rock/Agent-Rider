import { NextRequest, NextResponse } from "next/server";
import { getPredictionAccuracyLeaderboard } from "@/lib/comms";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minResolved = searchParams.get("min_resolved");
  const leaderboard = await getPredictionAccuracyLeaderboard(
    minResolved ? Number(minResolved) : undefined
  );
  return NextResponse.json({ leaderboard });
}
