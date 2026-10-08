/**
 * Shared billing identity for Toll 1 + Toll 2 metered routes.
 * Caller pays (ar_ key or merchant key) — not the subject agent.
 */

import { resolveByApiKey } from "@/lib/agents";
import { findSubscriptionByMerchantKey } from "@/lib/stripe";
import { sandboxDemoKey } from "./toll-sandbox-core.mjs";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * The public corruption-sandbox demo key. It is sandbox-only by
 * construction (routes branch before this function), but this guard makes
 * the invariant explicit: even if a route forgets the sandbox branch, the
 * demo key can never resolve to a payer.
 */
function isDemoKey(value: string | null): boolean {
  if (!value) return false;
  const demo = sandboxDemoKey();
  return !!demo && !demo.startsWith("ar_") && value === demo;
}

export type TollPayer =
  | {
      ok: true;
      kind: "ar_key";
      payer_id: string;
      agent_id: string;
      /** Stripe customer id when known; ar_ keys may lack one until linked. */
      stripe_customer_id: string | null;
    }
  | {
      ok: true;
      kind: "merchant";
      payer_id: string;
      stripe_customer_id: string;
      subscription_status: string;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

function extractBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Resolve billing payer from Authorization: Bearer ar_… or X-Merchant-Key.
 * Subject JWT / capability agent_id is never the payer.
 */
export async function resolveTollPayer(req: Request): Promise<TollPayer> {
  const merchantKey = req.headers.get("x-merchant-key");
  if (merchantKey) {
    if (isDemoKey(merchantKey)) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "sandbox_key_not_billable",
          hint: "demo keys run the corruption sandbox only — they never authorize real dispatch",
        },
      };
    }
    try {
      const subscription = await findSubscriptionByMerchantKey(merchantKey);
      if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) {
        return {
          ok: false,
          status: 402,
          body: { error: "invalid_or_inactive_merchant_key" },
        };
      }
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id ?? null;
      if (!customerId) {
        return {
          ok: false,
          status: 402,
          body: { error: "merchant_missing_customer", hint: "subscription has no Stripe customer" },
        };
      }
      return {
        ok: true,
        kind: "merchant",
        payer_id: `merchant:${merchantKey.slice(0, 16)}`,
        stripe_customer_id: customerId,
        subscription_status: subscription.status,
      };
    } catch (err) {
      console.error("resolveTollPayer: merchant check failed", (err as Error).message);
      return { ok: false, status: 500, body: { error: "merchant_key_check_failed" } };
    }
  }

  const apiKey = extractBearer(req);
  if (apiKey) {
    if (isDemoKey(apiKey)) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "sandbox_key_not_billable",
          hint: "demo keys run the corruption sandbox only — they never authorize real dispatch",
        },
      };
    }
    if (!apiKey.startsWith("ar_")) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "invalid_billing_credential",
          hint: "send Authorization: Bearer ar_… or X-Merchant-Key (caller pays)",
        },
      };
    }
    const participant = await resolveByApiKey(apiKey);
    if (!participant) {
      return { ok: false, status: 401, body: { error: "invalid_api_key" } };
    }
    return {
      ok: true,
      kind: "ar_key",
      payer_id: `ar:${participant.id}`,
      agent_id: participant.id,
      // ar_ keys are not Stripe customers yet — meter report no-ops without customer id;
      // free-tier counter still runs via checkMonthlyUsage.
      stripe_customer_id: null,
    };
  }

  return {
    ok: false,
    status: 401,
    body: {
      error: "missing_billing_auth",
      hint: "send Authorization: Bearer ar_… or X-Merchant-Key — caller pays, not the subject agent",
      schema_url: "/api/toll/schema",
      register_url: "/api/agents",
    },
  };
}

export function isTollPayerOk(
  p: TollPayer
): p is Extract<TollPayer, { ok: true }> {
  return p.ok === true;
}
