/**
 * Lab agent store on Rider MCP: check / translate / squeeze.
 * Three verbs only. Receipt or refuse. Bins run on spl-lab-agent.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const STORE =
  process.env.LAB_AGENT_URL?.replace(/\/$/, "") || "https://spl-lab-agent.fly.dev";

async function postVerb(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${STORE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({ ok: false, refuse: `http ${r.status}` }));
  return { status: r.status, store: STORE, ...(typeof j === "object" && j ? j : { raw: j }) };
}

export function registerLabAgentTools(
  server: McpServer,
  opts: {
    textResult: (data: unknown) => TextResult;
    errorResult: (err: unknown) => TextResult;
  }
) {
  const { textResult, errorResult } = opts;

  server.registerTool(
    "cuni_check",
    {
      description: "CuNi exactness or refuse. POST /v1/check. Receipt: verb, ok, source_hash, pin.",
      inputSchema: {
        source: z.string().describe("CuNi source"),
      },
    },
    async ({ source }) => {
      try {
        return textResult(await postVerb("/v1/check", { source }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "bank_paste",
    {
      description: "CuNi Bank: paste N, get X, prove or refuse. POST /v1/translate.",
      inputSchema: {
        source: z.string().describe("Python v1 subset or CuNi"),
        from: z.string().optional().describe("py | cuni"),
        to: z.string().optional().describe("catalog id, e.g. js"),
      },
    },
    async ({ source, from, to }) => {
      try {
        return textResult(
          await postVerb("/v1/translate", { source, from: from || "py", to: to || "js" })
        );
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "pccx_encode",
    {
      description: "PCCX squeeze. DECODE_OK or no file. Never expand. POST /v1/squeeze.",
      inputSchema: {
        data_b64: z.string().optional().describe("Base64 payload"),
        source: z.string().optional().describe("UTF-8 text if no data_b64"),
      },
    },
    async ({ data_b64, source }) => {
      try {
        return textResult(await postVerb("/v1/squeeze", { data_b64, source }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
