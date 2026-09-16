import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkGateForToken, isGateOk } from "@/lib/rider";
import { registerParticipant, resolveById } from "@/lib/agents";
