import { NextRequest, NextResponse } from "next/server";
import { fileSharePlannedBody, FILE_SHARE_HTTP_STATUS } from "@/lib/file-share";

/**
 * Agent file list / upload entry — PLANNED NOT LIVE.
 * Always 501 { error: "file_share_planned", status: "not_live" }.
 * Does not accept or store bytes.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}
