/**
 * Machine-readable schemas for Toll Tools wave 1.
 * Spread into TOLL_SCHEMAS in toll-schemas.ts.
 */
import type { TollEndpointSchema } from "./toll-schemas";

const TOLL_AUTH =
  "Authorization: Bearer ar_… (toll API key from POST /api/agents) or X-Merchant-Key (caller pays)";

export const TOOL_SCHEMAS_WAVE1: TollEndpointSchema[] = [
  {
    path: "/api/toll/tools/pcc-compress",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.01 per MB of input (10,000 µUSDC/MB, minimum 1,000 µUSDC)",
    gate: "Tool — PCC compression",
    body_schema: {
      type: "object",
      required: ["data_base64"],
      properties: {
        data_base64: {
          type: "string",
          description: "raw input bytes, base64-encoded; max 8MB decoded",
        },
      },
    },
    example: { data_base64: "aGVsbG8gd29ybGQ=" },
  },
  {
    path: "/api/toll/tools/pcc-verify",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.02 per verification (20,000 µUSDC)",
    gate: "Tool — PCC round-trip verification",
    body_schema: {
      type: "object",
      required: ["blob_base64", "orig_size", "expected_sha256"],
      properties: {
        blob_base64: { type: "string", description: "PCC-compressed blob, base64-encoded" },
        orig_size: { type: "integer", minimum: 1, description: "original byte size before compression" },
        expected_sha256: { type: "string", description: "hex SHA-256 of the original bytes" },
      },
    },
    example: {
      blob_base64: "…",
      orig_size: 47,
      expected_sha256: "e4d…",
    },
  },
  {
    path: "/api/toll/tools/attest-notarize",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.01 per notarization (10,000 µUSDC)",
    gate: "Tool — metered notarization",
    body_schema: {
      type: "object",
      required: ["payload"],
      properties: {
        payload: { type: "object", description: "the payload to notarize (payload hashed into the receipt)" },
      },
    },
    example: { payload: { treaty: "signed", parties: 2 } },
  },
  {
    path: "/api/toll/tools/attest-exactness",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.05 per check (50,000 µUSDC)",
    gate: "Tool — metered exactness check",
    body_schema: {
      type: "object",
      required: ["artifact", "claim"],
      properties: {
        artifact: { type: "object", description: "the code artifact to check" },
        claim: {
          type: "object",
          required: ["stdout"],
          properties: { stdout: { type: "string" } },
          description: "claimed exact output",
        },
      },
    },
    example: {
      artifact: { lang: "python", code: "print(1)" },
      claim: { stdout: "1\n" },
    },
  },
];
