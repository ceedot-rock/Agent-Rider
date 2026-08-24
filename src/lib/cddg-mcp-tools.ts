/**
 * CDDG residual MCP tool registration for Agent-Rider
 * Public surface: dual-exact residual planes, Smart Swarms, hierarchy, contract binding
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getResidualSystem,
  residualEnergy,
  N_PLANES,
  DOCTRINE_AGENTS,
} from "./cddg-residual";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type RequireRider = (token: string | undefined, scope: string) => Promise<{ agent_id: string }>;

export function registerCddgTools(
  server: McpServer,
  opts: {
    riderTokenField: z.ZodString;
    requireRider: RequireRider;
    textResult: (data: unknown) => TextResult;
    errorResult: (err: unknown) => TextResult;
  }
) {
  const { riderTokenField, requireRider, textResult, errorResult } = opts;
  const sys = getResidualSystem();

  server.registerTool(
    "cddg_query_plane",
    {
      description:
        "Query residual state of a single CDDG plane (0..359). Continuous Dark-Degree Geometry — public residual fingerprint surface.",
      inputSchema: {
        plane: z.number().describe("Plane index 0..359"),
      },
    },
    async ({ plane }) => {
      try {
        const n = Math.floor(plane);
        if (n < 0 || n >= N_PLANES) throw new Error("plane_out_of_range");
        return textResult({ ok: true, plane: sys.queryPlane(n) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cddg_residual_energy",
    {
      description:
        "Global residual energy, mirrored cost, and dual error (ΔE+ΔC must be ~0). Smart Frame residual summary.",
      inputSchema: {},
    },
    async () => textResult({ ok: true, ...residualEnergy() })
  );

  server.registerTool(
    "cddg_residual_summary",
    {
      description:
        "Compressed public residual summary — active planes, energy, dual error, top planes, swarm/bindings counts.",
      inputSchema: {},
    },
    async () => textResult({ ok: true, summary: sys.residualSummary() })
  );

  server.registerTool(
    "cddg_inject_swarm",
    {
      description:
        "Inject a Doctrine-of-3 Smart Swarm (Observer/Builder/Reflector) at an exact real angle on the residual planes. Dual-exact residual update. Requires rider token.",
      inputSchema: {
        rider_token: riderTokenField,
        theta: z.number().describe("Exact real angle (0..360)"),
      },
    },
    async ({ rider_token, theta }) => {
      try {
        await requireRider(rider_token, "cddg:inject");
        const swarm = sys.injectSwarm(theta);
        return textResult({
          ok: true,
          action: "swarm_injected",
          swarm,
          agents: DOCTRINE_AGENTS,
          summary: sys.residualSummary(),
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cddg_step",
    {
      description:
        "Run one residual-driven discrete step on the CDDG system. Dissipates residual energy under dual exactness.",
      inputSchema: {
        rider_token: riderTokenField.optional(),
      },
    },
    async ({ rider_token }) => {
      try {
        if (rider_token) await requireRider(rider_token, "cddg:step");
        const result = sys.step();
        return textResult({ ok: true, step: result });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cddg_awareness_cycle",
    {
      description:
        "Run Smart Frame awareness cycles (Doctrine of 3 ticks by default). Bottom-up residual dynamics + dual enforcement.",
      inputSchema: {
        rider_token: riderTokenField.optional(),
        ticks: z.number().optional().describe("1..9, default 3"),
      },
    },
    async ({ rider_token, ticks }) => {
      try {
        if (rider_token) await requireRider(rider_token, "cddg:awareness");
        const n = Math.min(9, Math.max(1, Math.floor(ticks ?? 3)));
        const reports = [];
        for (let t = 0; t < n; t++) {
          const step = sys.step();
          const summary = sys.residualSummary();
          const emergence = Math.max(0, 1 - Math.min(1, Math.abs(summary.globalEnergy)));
          reports.push({ tick: t + 1, step, emergence: Math.round(emergence * 1000) / 1000 });
        }
        return textResult({
          ok: true,
          ticks: n,
          reports,
          summary: sys.residualSummary(),
          stamp: "Smart Frame Certified · SFv1 · Level SF-1 · L/C/D",
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cddg_bind_contract",
    {
      description:
        "Bind a live Agent-Rider contract (ctr_…) to a residual plane. Emits a residual marker fingerprint. Prefer exactness.passed contracts.",
      inputSchema: {
        rider_token: riderTokenField,
        contract_id: z.string().describe("e.g. ctr_1ec3e1bdb32541f0"),
        plane_hint: z.number().optional().describe("Preferred CDDG plane 0..359"),
        frame_id: z.string().optional().describe("Smart Frame id, default SF-Root"),
      },
    },
    async ({ rider_token, contract_id, plane_hint, frame_id }) => {
      try {
        await requireRider(rider_token, "cddg:bind");
        const binding = sys.bindContract(
          contract_id,
          frame_id || "SF-Root",
          plane_hint != null ? Math.floor(plane_hint) : null
        );
        return textResult({ ok: true, binding, summary: sys.residualSummary() });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "cddg_list_bindings",
    {
      description: "List residual contract bindings on the residual fabric.",
      inputSchema: {},
    },
    async () => textResult({ ok: true, bindings: sys.listBindings() })
  );

  server.registerTool(
    "cddg_list_swarms",
    {
      description: "List recent Smart Swarm injections on residual planes.",
      inputSchema: {
        limit: z.number().optional().describe("Max records, default 20"),
      },
    },
    async ({ limit }) =>
      textResult({
        ok: true,
        swarms: sys.swarms.slice(0, Math.min(50, limit ?? 20)),
        total: sys.swarms.length,
        doctrine: DOCTRINE_AGENTS,
      })
  );
}
