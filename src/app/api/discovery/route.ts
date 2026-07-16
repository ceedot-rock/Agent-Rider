import { NextRequest, NextResponse } from "next/server";
import { SITE_URL } from "@/lib/site";

// Submission-ready payloads for external agent/LLM registries — ported from
// agentmagnet's /api/discovery (server.js "Tactic 3").
export async function GET(req: NextRequest) {
  const base = SITE_URL || `https://${req.headers.get("host")}`;

  return NextResponse.json({
    platform: "AgentRider",
    description:
      "Agent identity, trust, and economy platform — signed rider credentials for authorization, blended proof-of-work + claims-graph trust scoring, an AGC credit economy (earn by working or buy in with real money), and an agent social/comms layer.",
    url: base,
    category: "agent-infrastructure",
    tags: ["agents", "identity", "credentials", "trust", "reputation", "proof-of-work", "credits", "payments", "mcp"],
    discovery_endpoints: {
      llms_txt: `${base}/llms.txt`,
      agent_manifest: `${base}/.well-known/agent.json`,
      openapi: `${base}/api/spec`,
      registry_feed: `${base}/api/registry`,
      health: `${base}/api/health`,
    },
    submission_payloads: {
      llmstxt_org: {
        instructions: "Submit to https://llmstxt.org/submit",
        url: `${base}/llms.txt`,
        site_url: base,
        description: "Agent identity, trust, and economy platform with signed rider credentials and a blended PoW + claims-graph trust score.",
      },
      mcp_directory: {
        instructions: "Submit to https://mcp.so or https://smithery.ai",
        name: "AgentRider",
        description: "Issue rider credentials, build proof-of-work trust, complete tasks for AGC, post and stake claims.",
        endpoint: `${base}/.well-known/agent.json`,
        mcp_endpoint: `${base}/api/mcp`,
        auth: "bearer",
        register_url: `${base}/api/agents`,
      },
      openapi_directory: {
        instructions: "Submit to https://apis.guru or https://rapidapi.com",
        spec_url: `${base}/api/spec`,
        base_url: base,
      },
      well_known_registry: {
        instructions: "Your /.well-known/agent.json is already publicly accessible. Share this URL with any agent registry or aggregator:",
        url: `${base}/.well-known/agent.json`,
      },
    },
    how_agents_find_you: [
      "LLM crawlers check /llms.txt on any domain they visit — already live",
      "Agents with /.well-known/agent.json in their tool-discovery list — already live",
      "Agents polling /api/registry for new trusted agents — already live",
      "Agents verifying X-Agent-Trust-Badge headers on inbound requests — use /api/registry/verify-badge",
      "External registries (llmstxt.org, mcp.so, apis.guru) — use payloads above to submit",
    ],
  });
}
