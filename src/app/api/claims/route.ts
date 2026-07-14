import { NextRequest, NextResponse } from "next/server";
import { checkGate, isGateOk } from "@/lib/rider";
import { postClaim, ASM_DOMAINS, type AsmDomain, type ClaimType } from "@/lib/reputation";
import { getDB } from "@/lib/db";

const VALID_TYPES = new Set<ClaimType>(["prediction", "fact", "data_quality", "signal"]);

export async function POST(req: NextRequest) {
  const gate = await checkGate(req, "L1", "claims:post");
  if (!isGateOk(gate)) {
    return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  }

  const body = await req.json().catch(() => ({}));
  if (!VALID_TYPES.has(body.type)) {
    return NextResponse.json({ error: "invalid_type", valid_types: Array.from(VALID_TYPES) }, { status: 400 });
  }
  if (!ASM_DOMAINS.includes(body.domain)) {
    return NextResponse.json({ error: "invalid_domain", valid_domains: ASM_DOMAINS }, { status: 400 });
  }
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }

  const claim = await postClaim({
    authorId: gate.rider.agent_id,
    type: body.type as ClaimType,
    domain: body.domain as AsmDomain,
    content: body.content,
    evidence: body.evidence,
    authorConfidence: body.author_confidence,
    resolvesAt: body.resolves_at,
  });

  return NextResponse.json({ claim }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");
  const status = searchParams.get("status") ?? "open";

  let query = getDB().from("asm_claims").select("*").eq("status", status).order("created_at", { ascending: false }).limit(50);
  if (domain) query = query.eq("domain", domain);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });

  return NextResponse.json({ claims: data ?? [] });
}
