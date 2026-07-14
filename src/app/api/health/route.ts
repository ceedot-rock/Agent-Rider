import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

// Standard first-check for agents — ported from agentmagnet's /health.
export async function GET() {
  const db = getDB();
  const [{ count: participants }, { count: openTasks }] = await Promise.all([
    db.from("participants").select("id", { count: "exact", head: true }),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return NextResponse.json({
    status: "ok",
    platform: "AgentRider",
    timestamp: new Date().toISOString(),
    stats: {
      participants: participants ?? 0,
      openTasks: openTasks ?? 0,
    },
  });
}
