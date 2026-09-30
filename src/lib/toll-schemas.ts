/**
 * Machine-readable schemas for every toll endpoint.
 *
 * Served at GET /api/toll/schema. An agent that gets a 400/401 from any
 * toll route can fetch this document instead of guessing field shapes.
 * Each entry: path, method, auth, price, JSON Schema for the request body,
 * and a working example.
 */

export interface TollEndpointSchema {
  path: string;
  method: "POST";
  auth: string;
  price: string;
  gate: string;
  body_schema: Record<string, unknown>;
  example: Record<string, unknown>;
}

const TOLL_AUTH =
  "Authorization: Bearer ar_… (toll API key from POST /api/agents) or X-Merchant-Key (caller pays)";

export const TOLL_SCHEMAS: TollEndpointSchema[] = [
  {
    path: "/api/toll/v1/verify",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.005/query after 100 free/month",
    gate: "Gate 1 — identity verify",
    body_schema: {
      type: "object",
      required: ["rider"],
      properties: { rider: { type: "string", description: "agent rider credential (JWT)" } },
    },
    example: { rider: "<rider-jwt>" },
  },
  {
    path: "/api/toll/v2/lookup",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.02/lookup",
    gate: "Gate 2 — discovery lookup",
    body_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        min_evidence: { type: "string", default: "L1_receipt" },
        limit: { type: "integer", default: 10 },
      },
    },
    example: { query: "escrow agent", limit: 5 },
  },
  {
    path: "/api/toll/v2/promote",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$9/month per capability (Stripe subscription)",
    gate: "Gate 2 — promoted placement",
    body_schema: {
      type: "object",
      required: ["capability_id"],
      properties: {
        capability_id: { type: "string" },
        email: { type: "string", format: "email", description: "optional, for the Stripe receipt" },
      },
    },
    example: { capability_id: "cap_abc123" },
  },
  {
    path: "/api/toll/v3/escrow",
    method: "POST",
    auth: TOLL_AUTH,
    price: "1% of escrowed amount",
    gate: "Gate 3 — escrow lock",
    body_schema: {
      type: "object",
      required: ["agent_id", "amount_uusdc", "job_id", "job_spec_hash", "timeout_sec"],
      properties: {
        agent_id: { type: "string" },
        amount_uusdc: { type: "integer", minimum: 1, description: "micro-USDC (1 USDC = 1,000,000)" },
        job_id: { type: "string" },
        job_spec_hash: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1 },
      },
    },
    example: {
      agent_id: "a4fbaf7cafaf3016",
      amount_uusdc: 1000000,
      job_id: "job-1",
      job_spec_hash: "sha256:…",
      timeout_sec: 3600,
    },
  },
  {
    path: "/api/toll/v3/escrow/release",
    method: "POST",
    auth: TOLL_AUTH,
    price: "1% of escrowed amount",
    gate: "Gate 3 — escrow release",
    body_schema: {
      type: "object",
      required: ["escrow_id", "delivery_receipt_envelope"],
      properties: {
        escrow_id: { type: ["integer", "string"] },
        delivery_receipt_envelope: { type: "object", description: "signed delivery receipt" },
      },
    },
    example: { escrow_id: 3, delivery_receipt_envelope: {} },
  },
  {
    path: "/api/toll/v4/grants/issue",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.01/issue",
    gate: "Gate 4 — grant issue",
    body_schema: {
      type: "object",
      required: ["agent_id", "cap_uusdc", "grantor", "scope", "not_before", "not_after"],
      properties: {
        agent_id: { type: "string" },
        cap_uusdc: { type: "integer", minimum: 1 },
        grantor: { type: "string" },
        scope: { type: "array", items: { type: "string" }, description: "non-empty list of action strings" },
        not_before: { type: "integer", description: "epoch seconds" },
        not_after: { type: "integer", description: "epoch seconds" },
        revocable: { type: "boolean", default: true },
      },
    },
    example: {
      agent_id: "a4fbaf7cafaf3016",
      cap_uusdc: 1000,
      grantor: "my-org",
      scope: ["read", "compute"],
      not_before: 1759104000,
      not_after: 1761782400,
    },
  },
  {
    path: "/api/toll/v4/grants/check",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.005/check",
    gate: "Gate 4 — grant check",
    body_schema: {
      type: "object",
      required: ["action", "amount_uusdc", "grant_envelope"],
      properties: {
        action: { type: "string" },
        amount_uusdc: { type: "integer", minimum: 0 },
        grant_envelope: { type: "object", description: "envelope returned by grants/issue" },
        jwks: { type: "object", description: "optional JWKS override for verification" },
        revocation_checked_at: { type: "integer", description: "optional epoch seconds" },
      },
    },
    example: { action: "read", amount_uusdc: 10, grant_envelope: {} },
  },
  {
    path: "/api/toll/v5/check",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.10/check",
    gate: "Gate 5 — CuNi exactness check",
    body_schema: {
      type: "object",
      required: ["artifact", "claim"],
      properties: {
        artifact: { type: "object", description: "the code artifact to check" },
        claim: {
          type: "object",
          required: ["stdout"],
          properties: { stdout: { type: "string", description: "claimed exact output" } },
          description: "must be a dict with a string 'stdout'",
        },
      },
    },
    example: { artifact: { lang: "python", code: "print(1)" }, claim: { stdout: "1\n" } },
  },
  {
    path: "/api/toll/v6/bonds/stake",
    method: "POST",
    auth: TOLL_AUTH,
    price: "1% of staked amount",
    gate: "Gate 6 — bond stake",
    body_schema: {
      type: "object",
      required: ["agent_id", "amount_uusdc", "conditions"],
      properties: {
        agent_id: { type: "string" },
        amount_uusdc: { type: "integer", minimum: 1, description: "must not exceed your toll_mock_balances" },
        conditions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["on", "slash_pct"],
            properties: {
              on: {
                type: "string",
                enum: ["dispute_upheld", "oracle_fail", "oracle_refuse", "timeout_default"],
              },
              slash_pct: { type: "number", minimum: 0, maximum: 100 },
            },
          },
        },
      },
    },
    example: {
      agent_id: "a4fbaf7cafaf3016",
      amount_uusdc: 100,
      conditions: [{ on: "oracle_refuse", slash_pct: 50 }],
    },
  },
  {
    path: "/api/toll/v6/bonds/slash",
    method: "POST",
    auth: TOLL_AUTH,
    price: "1% of staked amount",
    gate: "Gate 6 — bond slash",
    body_schema: {
      type: "object",
      required: ["bond_id", "trigger", "evidence_envelope"],
      properties: {
        bond_id: { type: "string" },
        trigger: {
          type: "string",
          enum: ["dispute_upheld", "oracle_fail", "oracle_refuse", "timeout_default"],
        },
        evidence_envelope: { type: "object", description: "signed evidence for the trigger" },
      },
    },
    example: { bond_id: "bond_1", trigger: "oracle_refuse", evidence_envelope: {} },
  },
  {
    path: "/api/toll/v7/memory/export",
    method: "POST",
    auth: TOLL_AUTH,
    price: "$0.02/export",
    gate: "Gate 7 — memory transfer",
    body_schema: {
      type: "object",
      required: ["agent_id", "to_host", "memories"],
      properties: {
        agent_id: { type: "string" },
        to_host: { type: "string", description: "destination host, non-empty" },
        memories: { type: "array", items: { type: "object" } },
        weights_ref: { type: ["string", "null"], description: "optional weights reference" },
      },
    },
    example: { agent_id: "a4fbaf7cafaf3016", to_host: "host-b", memories: [] },
  },
  {
    path: "/api/toll/balance/topup",
    method: "POST",
    auth: TOLL_AUTH,
    price: "no fee — you pay only the USD amount",
    gate: "Funding rail — top up toll mock balance",
    body_schema: {
      type: "object",
      required: ["amount_usd_cents"],
      properties: {
        amount_usd_cents: {
          type: "integer",
          minimum: 100,
          maximum: 50000,
          description: "$1–$500; 1 USD = 1,000,000 micro-USDC credited on payment",
        },
        agent_id: {
          type: "string",
          description: "merchants only: which agent to fund; ar_ keys fund themselves",
        },
      },
    },
    example: { amount_usd_cents: 500 },
  },
];

export function tollSchemaDoc() {
  return {
    live: true,
    auth: TOLL_AUTH,
    register: "POST /api/agents → { agent_id, api_key } — self-service, no human needed",
    funding:
      "Gates 3 and 6 spend toll mock USDC (toll_mock_balances). Fund via POST /api/toll/balance/topup.",
    endpoints: TOLL_SCHEMAS,
  };
}
