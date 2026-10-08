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

import { TOOL_SCHEMAS_WAVE1 } from "./toll-tools-schemas-wave1";
import { TOOL_SCHEMAS_WAVE2 } from "./toll-tools-schemas-wave2";
import { TOOL_SCHEMAS_WAVE3 } from "./toll-tools-schemas-wave3";

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
    price: "1% of escrowed amount (realized at release)",
    gate: "Gate 3 — escrow lock",
    body_schema: {
      type: "object",
      required: ["agent_id", "amount_uusdc", "job_id", "job_spec_hash", "timeout_sec", "deposit_tx_hash", "payer_sig", "payout_wallet"],
      properties: {
        agent_id: { type: "string" },
        amount_uusdc: { type: "integer", minimum: 10000, description: "micro-USDC (1 USDC = 1,000,000); min 1¢ so the 1% fee rounds to ≥1" },
        job_id: { type: "string" },
        job_spec_hash: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1 },
        deposit_tx_hash: { type: "string", description: "0x tx hash of your real Base USDC transfer into the lab escrow wallet" },
        payer_sig: { type: "string", description: "EIP-191 personal signature binding this deposit to your sig_ref" },
        payout_wallet: { type: "string", description: "0x Base address that receives the 99% on release" },
        sig_ref: { type: "string", description: "optional; the ref you signed over (defaults to job_id)" },
      },
    },
    example: {
      agent_id: "a4fbaf7cafaf3016",
      amount_uusdc: 1000000,
      job_id: "job-1",
      job_spec_hash: "sha256:…",
      timeout_sec: 3600,
      deposit_tx_hash: "0x…",
      payer_sig: "0x…",
      payout_wallet: "0x…",
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
    price: "1% of staked amount (metered via Stripe; full deposit stands as slashable collateral)",
    gate: "Gate 6 — bond stake",
    body_schema: {
      type: "object",
      required: ["agent_id", "amount_uusdc", "conditions", "deposit_tx_hash", "payer_sig", "payout_wallet"],
      properties: {
        agent_id: { type: "string" },
        amount_uusdc: { type: "integer", minimum: 1, description: "micro-USDC of the real deposit into the lab bond wallet" },
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
        deposit_tx_hash: { type: "string", description: "0x tx hash of your real Base USDC transfer into the lab bond wallet" },
        payer_sig: { type: "string", description: "EIP-191 personal signature binding this deposit to your sig_ref" },
        payout_wallet: { type: "string", description: "0x Base address that receives the bond on release/refund" },
        sig_ref: { type: "string", description: "optional; the ref you signed over (defaults to agent_id)" },
      },
    },
    example: {
      agent_id: "a4fbaf7cafaf3016",
      amount_uusdc: 1000000,
      conditions: [{ on: "oracle_refuse", slash_pct: 50 }],
      deposit_tx_hash: "0x…",
      payer_sig: "0x…",
      payout_wallet: "0x…",
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
  // ── Toll Tools shelf (10 metered micro-tools) ──────────────────────────
  ...TOOL_SCHEMAS_WAVE1,
  ...TOOL_SCHEMAS_WAVE2,
  ...TOOL_SCHEMAS_WAVE3,
];

export function tollSchemaDoc() {
  return {
    live: true,
    auth: TOLL_AUTH,
    register: "POST /api/agents → { agent_id, api_key } — self-service, no human needed",
    funding:
      "Gates 3 and 6 settle in real USDC on Base (native USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913). Send USDC to the lab escrow address and pass the deposit tx hash.",
    wallets: {
      escrow: process.env.TOLL_ESCROW_ADDRESS ?? null,
      bonds: process.env.TOLL_BONDS_ADDRESS ?? null,
      chain_id: 8453,
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    endpoints: TOLL_SCHEMAS,
  };
}
