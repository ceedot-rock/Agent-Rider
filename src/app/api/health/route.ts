import { NextResponse } from "next/server";
import { classifyDbError, getDB, resolveSupabaseCreds } from "@/lib/db";
import { countDiskParticipants } from "@/lib/agents";
import { FILE_SHARE_PUBLIC_COPY, isFileShareLiveFlag } from "@/lib/file-share";
import { emptyProvenanceCounts, tallyProvenance, type ProvenanceCounts } from "@/lib/provenance";

export async function GET() {
  const creds = resolveSupabaseCreds();
  const hasDb = Boolean(creds.url && creds.key);
  const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasRider = Boolean(process.env.RIDER_PRIVATE_KEY && process.env.RIDER_PUBLIC_KEY);
  let stats: {
    participants: number;
    openTasks: number;
    diskParticipants: number;
    by_provenance: ProvenanceCounts;
  } = {
    participants: 0,
    openTasks: 0,
    diskParticipants: countDiskParticipants(),
    by_provenance: emptyProvenanceCounts(),
  };
  let dbError: string | null = null;
  let dbClass: ReturnType<typeof classifyDbError> = hasDb ? "other" : "ok";
  let dbReachable = false;

  if (hasDb) {
    try {
      const db = getDB();
      const [{ count: participants, error: pErr }, { count: openTasks, error: tErr }, provRes] =
        await Promise.all([
          db.from("participants").select("id", { count: "exact", head: true }),
          db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
          db.from("participants").select("provenance"),
        ]);
      dbError = pErr?.message ?? tErr?.message ?? (provRes.error?.message ?? null);
      // Soft: missing provenance column → still reachable if counts worked
      if (provRes.error && /provenance/i.test(provRes.error.message ?? "")) {
        dbError = pErr?.message ?? tErr?.message ?? null;
      }
      dbClass = classifyDbError(dbError);
      dbReachable = !dbError;
      const by_provenance =
        !provRes.error && Array.isArray(provRes.data)
          ? tallyProvenance(provRes.data.map((r: { provenance?: string | null }) => r.provenance))
          : emptyProvenanceCounts();
      stats = {
        participants: participants ?? 0,
        openTasks: openTasks ?? 0,
        diskParticipants: stats.diskParticipants,
        by_provenance,
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
    file_share: {
      live: false,
      status: "not_live",
      error: "file_share_planned",
      flag_FILE_SHARE_LIVE: isFileShareLiveFlag(),
      message: FILE_SHARE_PUBLIC_COPY,
    },
    missing: [
      !hasRider && "RIDER_PRIVATE_KEY",
      !hasDb && "SUPABASE_SERVICE_ROLE_KEY",
      !hasStripe && "STRIPE_SECRET_KEY",
    ].filter(Boolean),
    stats,
    db: {
      configured: hasDb,
      reachable: dbReachable,
      error_class: dbClass,
    },
  });
}
