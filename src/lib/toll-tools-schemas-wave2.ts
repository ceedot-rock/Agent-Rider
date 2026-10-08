/**
 * Machine-readable schemas for Toll Tools wave 2 (ExactOdds).
 * Spread into TOLL_SCHEMAS in toll-schemas.ts.
 * NOTE: body shapes follow the upstream exactodds-api routes — the wave-2
 * builder verified them before wiring; refine here if upstream changes.
 */
import type { TollEndpointSchema } from "./toll-schemas";

const TOLL_AUTH =
  "Authorization: Bearer ar_… (toll API key from POST /api/agents) or X-Merchant-Key (caller pays)";

export const TOOL_SCHEMAS_WAVE2: TollEndpointSchema[] = [
  {
    path: "/api/toll/tools/exactodds-draw",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.01 per draw (10,000 µUSDC)",
    gate: "Tool — verifiable random draw",
    body_schema: {
      type: "object",
      required: ["game_id"],
      properties: {
        game_id: { type: "string", description: "ExactOdds game identifier" },
        draw_id: { type: "string", description: "optional client draw id (idempotency)" },
        count: { type: "integer", minimum: 1, maximum: 100, default: 1 },
      },
    },
    example: { game_id: "coin-flip", count: 1 },
  },
  {
    path: "/api/toll/tools/exactodds-resolve",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.02 per resolution (20,000 µUSDC)",
    gate: "Tool — fair game/bet settlement",
    body_schema: {
      type: "object",
      required: ["game_id", "draw_id"],
      properties: {
        game_id: { type: "string", description: "ExactOdds game identifier" },
        draw_id: { type: "string", description: "the draw to resolve" },
      },
    },
    example: { game_id: "coin-flip", draw_id: "draw_abc123" },
  },
];
