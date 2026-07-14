import { NextRequest, NextResponse } from "next/server";
import { resolveById } from "@/lib/agents";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const participant = await resolveById(id);
  if (!participant) {
    return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    id: participant.id,
    name: participant.name,
    type: participant.type,
    credits: participant.credits,
    tasksCompleted: participant.tasksCompleted,
  });
}
