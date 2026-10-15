/**
 * Machine-readable schemas for Toll Tools wave 3.
 * Spread into TOLL_SCHEMAS in toll-schemas.ts.
 */
import type { TollEndpointSchema } from "./toll-schemas";

const TOLL_AUTH =
  "Authorization: Bearer ar_… (toll API key from POST /api/agents) or X-Merchant-Key (caller pays)";

export const TOOL_SCHEMAS_WAVE3: TollEndpointSchema[] = [
  {
    path: "/api/toll/tools/cuni-proof",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.10 per proof (100,000 µUSDC)",
    gate: "Tool — CuNi exactness proof",
    body_schema: {
      type: "object",
      required: ["source"],
      properties: {
        source: {
          type: "string",
          description: "CuNi source text (.cuni); max 64KB",
        },
        seats: {
          type: "array",
          items: { type: "string" },
          description: "optional seat ids to check (default: js,py — the toolchains in the image)",
        },
      },
    },
    example: { source: "main() { print(1 + 2) }", seats: ["js", "py"] },
  },
  {
    path: "/api/toll/tools/trustream-pack",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.01 per MB of input (10,000 µUSDC/MB, minimum 1,000 µUSDC)",
    gate: "Tool — TRUSTREAM stream packing",
    body_schema: {
      type: "object",
      required: ["data_base64"],
      properties: {
        data_base64: {
          type: "string",
          description: "raw stream bytes, base64-encoded; max 8MB decoded; packed as 4KB tiles",
        },
      },
    },
    example: { data_base64: "AAAAAAAAAAAAAAAA…" },
  },
  {
    path: "/api/toll/tools/chamber-seal",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.02 per seal (20,000 µUSDC)",
    gate: "Tool — Chamber-sealed envelope",
    body_schema: {
      type: "object",
      required: ["payload"],
      properties: {
        payload: { type: "object", description: "the payload to seal (hashed into the envelope)" },
      },
    },
    example: { payload: { custody: "transfer", item: "doc-9" } },
  },
  {
    path: "/api/toll/tools/awlpay-quote",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.005 per quote (5,000 µUSDC)",
    gate: "Tool — cross-rail payment quote",
    body_schema: {
      type: "object",
      required: ["amount_uusdc", "rail"],
      properties: {
        amount_uusdc: {
          type: "integer",
          minimum: 1,
          description: "integer micro-USDC to move (1 USDC = 1,000,000)",
        },
        rail: {
          type: "string",
          enum: ["tron", "bitcoin", "lightning", "stellar", "bsc", "base"],
          description: "destination rail",
        },
      },
    },
    example: { amount_uusdc: 1000000, rail: "tron" },
  },
];
