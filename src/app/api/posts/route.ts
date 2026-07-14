import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { createPost, listFeed } from "@/lib/social";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const posts = await listFeed(
    searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    searchParams.get("hashtag") ?? undefined
  );
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "posts:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }

  try {
    const post = await createPost(gate.rider.agent_id, body.content, body.hashtags);
    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
