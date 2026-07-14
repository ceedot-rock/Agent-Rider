import { NextResponse } from "next/server";
import { listChannels } from "@/lib/channels";

export async function GET() {
  return NextResponse.json({ channels: await listChannels() });
}
