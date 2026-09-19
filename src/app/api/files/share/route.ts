import { NextRequest, NextResponse } from "next/server";
import { fileSharePlannedBody, FILE_SHARE_HTTP_STATUS } from "@/lib/file-share";

/**
 * Agent-to-agent file share — PLANNED NOT LIVE.
 * Always 501; never transfers. Same signed seats when it ships.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}

export async function GET(_req: NextRequest) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}
