import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/tasks";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const task = await getTask(id);
    return NextResponse.json({ task });
  } catch {
    return NextResponse.json({ error: "task_not_found" }, { status: 404 });
  }
}
