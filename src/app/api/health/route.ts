import { NextResponse } from "next/server";
import { classifyDbError, getDB, resolveSupabaseCreds } from "@/lib/db";
import { countDiskParticipants } from "@/lib/agents";

export async function GET() {
  const creds = resolveSupabaseCreds();
  const hasDb = Boolean(creds.url && creds.key);
  const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasRider = Boolean(process.env.RIDER_PRIVATE_KEY && process.env.RIDER_PUBLIC_KEY);
  let stats = { participants: 0, openTasks: 0, diskParticipants: countDiskParticipants() };
  let dbError: string | null = null;
  let dbClass: ReturnType<typeof classifyDbError> = hasDb ? "other" : "ok";
  let dbReachable = false;

  if (hasDb) {
    try {
      const db = getDB();
      const [{ count: participants, error: pErr }, { count: openTasks, error: tErr }] = await Promise.all([
        db.from("participants").select("id", { count: "exact", head: true }),
        db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      dbError = pErr?.message ?? tErr?.message ?? null;
      dbClass = classifyDbError(dbError);
      dbReachable = !dbError;
      stats = {
        participants: participants ?? 0,
        openTasks: openTasks ?? 0,
        diskParticipants: stats.diskParticipants,
      };
    } catch (e: unknown) {
      dbError = e instanceof Error ? e.message.slice(0, 160) : "db_failed";
      dbClass = classifyDbError(dbError);
    }
  }

  return NextResponse.json({
    status: "ok",
    platform: "AgentRider",
    timestamp: new Date().toISOString(),
    host: "fly",
    ready: { rider: hasRider, db: hasDb && dbReachable, stripe: hasStripe },
    missing: [
      !hasRider && "RIDER_PRIVATE_KEY",
      !hasDb && "SUPABASE_SERVICE_ROLE_KEY",
      !hasStripe && "STRIPE_SECRET_KEY",
    ].filter(Boolean),
    stats,
    supabase: {
      configured: hasDb,
      reachable: dbReachable,
      error_class: dbClass,
      error: dbError,
      key_kind: creds.keyKind,
      key_source: creds.keySource,
      url_host: creds.urlHost,
      url_source: creds.urlSource,
    },
  });
}
