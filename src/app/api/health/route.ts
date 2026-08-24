import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET() {
  const hasDb = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasRider = Boolean(process.env.RIDER_PRIVATE_KEY && process.env.RIDER_PUBLIC_KEY);
  let stats = { participants: 0, openTasks: 0 };
  if (hasDb) {
    try {
      const db = getDB();
      const [{ count: participants }, { count: openTasks }] = await Promise.all([
        db.from("participants").select("id", { count: "exact", head: true }),
        db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      stats = { participants: participants ?? 0, openTasks: openTasks ?? 0 };
    } catch {
      /* stats stay 0 */
    }
  }
  return NextResponse.json({
    status: "ok",
    platform: "AgentRider",
    timestamp: new Date().toISOString(),
    host: "fly",
    ready: { rider: hasRider, db: hasDb, stripe: hasStripe },
    missing: [
      !hasRider && "RIDER_PRIVATE_KEY",
      !hasDb && "SUPABASE_SERVICE_ROLE_KEY",
      !hasStripe && "STRIPE_SECRET_KEY",
    ].filter(Boolean),
    stats,
  });
}
