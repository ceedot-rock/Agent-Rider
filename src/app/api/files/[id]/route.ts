import { NextRequest, NextResponse } from "next/server";
import { fileSharePlannedBody, FILE_SHARE_HTTP_STATUS } from "@/lib/file-share";

/**
 * Fetch / delete a shared file by id — PLANNED NOT LIVE.
 * Path param ignored; always 501 planned.
 */
export async function GET(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}

export async function DELETE(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(fileSharePlannedBody(), { status: FILE_SHARE_HTTP_STATUS });
}
