import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { publishTool, listTools, TOOL_CATEGORIES, type ToolCategory } from "@/lib/marketplace";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;
  const tools = await listTools({
    category: category as ToolCategory | undefined,
    sort: sort === "recent" ? "recent" : "installs",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json({ tools });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "tools:publish");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.name || !body.description || !body.category) {
    return NextResponse.json({ error: "missing_fields", need: ["name", "description", "category"] }, { status: 400 });
  }
  if (!TOOL_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "invalid_category", valid_categories: TOOL_CATEGORIES }, { status: 400 });
  }

  try {
    const tool = await publishTool({
      authorAgentId: gate.rider.agent_id,
      name: body.name,
      description: body.description,
      category: body.category,
      endpointUrl: body.endpointUrl,
      version: body.version,
      tags: body.tags,
    });
    return NextResponse.json({ tool }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
