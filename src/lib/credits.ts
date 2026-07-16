import { getDB } from "@/lib/db";
import { resolveById, adjustCredits, recordTransaction } from "@/lib/agents";

// AGC credit economy — ported from agentmagnet/routes/tokens.js.
export const SERVICE_COSTS: Record<string, number> = {
  search: 2,
  analyze: 3,
  generate: 5,
  export: 8,
  priority: 10,
};

// Credits buy-in pricing — $1 = 100 AGC, flat, no bonus tiers until there's
// a reason to complicate it. Shared by /api/credits/purchase and the
// purchase_credits MCP tool so the two surfaces can't drift.
export const CREDITS_PER_USD = Number(process.env.CREDITS_PER_USD ?? 100);
export const MIN_PURCHASE_USD_CENTS = 100; // $1
export const MAX_PURCHASE_USD_CENTS = 50000; // $500 per purchase

export function usdCentsToCredits(usdCents: number): number {
  return Math.round((usdCents / 100) * CREDITS_PER_USD);
}

export interface TransferResult {
  yourBalance: number;
  recipientBalance: number;
}

export async function transferCredits(fromId: string, toId: string, amount: number): Promise<TransferResult> {
  if (amount <= 0) throw new Error("amount must be positive");

  const [sender, recipient] = await Promise.all([resolveById(fromId), resolveById(toId)]);
  if (!sender) throw new Error("sender_not_found");
  if (!recipient) throw new Error("recipient_not_found");
  if (sender.credits < amount) throw new Error("insufficient_credits");

  const yourBalance = await adjustCredits(fromId, -amount, "transfer_out", { toId, toName: recipient.name });
  const recipientBalance = await adjustCredits(toId, amount, "transfer_in", { fromId, fromName: sender.name });

  return { yourBalance, recipientBalance };
}

export interface SpendResult {
  creditsSpent: number;
  creditsRemaining: number;
  service: string;
  units: number;
  generated?: string;
}

// The `generate` service calls Anthropic directly and refunds on failure —
// every other service is a flat metered credit debit.
export async function spendCredits(
  participantId: string,
  service: string,
  units = 1,
  prompt?: string
): Promise<SpendResult> {
  const costPerUnit = SERVICE_COSTS[service];
  if (!costPerUnit) throw new Error("unknown_service");

  const participant = await resolveById(participantId);
  if (!participant) throw new Error("participant_not_found");

  const cost = costPerUnit * units;
  if (participant.credits < cost) throw new Error("insufficient_credits");

  if (service === "generate") {
    if (!prompt) throw new Error("prompt_required");

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let generated: string;
    try {
      const message = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      generated = block.type === "text" ? block.text : "";
    } catch (err) {
      throw new Error(`generation_failed: ${(err as Error).message}`);
    }

    const remaining = await adjustCredits(participantId, -cost, "spend", {
      service,
      units,
      prompt: prompt.slice(0, 100),
    });
    return { creditsSpent: cost, creditsRemaining: remaining, service, units, generated };
  }

  const remaining = await adjustCredits(participantId, -cost, "spend", { service, units });
  return { creditsSpent: cost, creditsRemaining: remaining, service, units };
}

export async function getTransactionHistory(participantId: string, limit = 20) {
  const db = getDB();
  const { data } = await db
    .from("transactions")
    .select("*")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));
  return data ?? [];
}

// 25% of an agent's earnings mirror to the human operator who deployed it —
// ported from agentmagnet's "Dual Incentive Mirror".
export async function mirrorCreditToOperator(agentId: string, amount: number): Promise<void> {
  const agent = await resolveById(agentId);
  if (!agent || agent.type !== "agent" || !agent.referredBy) return;

  const human = await resolveById(agent.referredBy);
  if (!human || human.type !== "human") return;

  const mirror = Math.floor(amount * 0.25);
  if (mirror <= 0) return;

  await adjustCredits(human.id, mirror, "mirror", { fromAgent: agentId, agentName: agent.name });
}

export { recordTransaction };
