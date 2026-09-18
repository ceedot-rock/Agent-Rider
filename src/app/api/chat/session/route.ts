import { NextResponse } from "next/server";
import { sessionStatus } from "@/lib/chat-gate";

export async function GET() {
  const status = await sessionStatus();
  return NextResponse.json(status);
}
