/**
 * AMP settle adapter stub — feature-flagged, OFF by default.
 *
 * Honesty: does NOT settle AMP. Live hop debit remains XPay (Base USDC / x402).
 * Flip only when AMP_MILESTONE.md checklist is green and AMP_SETTLE_LIVE=true.
 *
 * Never log ar_ / payment payloads / PEMs.
 */

export const AMP_SETTLE_LIVE_ENV = "AMP_SETTLE_LIVE" as const;

export const AMP_SETTLE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/AMP_SANDBOX.md" as const;

export const AMP_MILESTONE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/AMP_MILESTONE.md" as const;

/** True only when AMP_SETTLE_LIVE is explicitly "true" (or 1/yes). Default false. */
export function isAmpSettleLive(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  const raw = env[AMP_SETTLE_LIVE_ENV];
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type AmpSettleAttempt = {
  ok: false;
  status: 501;
  body: {
    error: "amp_settle_not_live";
    status: "not_live";
    live: false;
    hop_default: "xpay";
    message: string;
    docs_url: typeof AMP_SETTLE_DOCS;
    milestone_url: typeof AMP_MILESTONE_DOCS;
    feature_flag: { name: typeof AMP_SETTLE_LIVE_ENV; value: boolean; note: string };
  };
};

/**
 * Attempt AMP settle. Always fail-closed today:
 * - flag off → 501 amp_settle_not_live (callers must keep XPay path)
 * - flag on → still 501 until a proven adapter replaces this stub
 *
 * Live settle route must NOT call this for the default hop — XPay stays sole live rail.
 */
export function attemptAmpSettle(_input?: {
  mandate?: unknown;
  paymentToken?: unknown;
  resource?: string;
}): AmpSettleAttempt {
  const liveFlag = isAmpSettleLive();
  return {
    ok: false,
    status: 501,
    body: {
      error: "amp_settle_not_live",
      status: "not_live",
      live: false,
      hop_default: "xpay",
      message: liveFlag
        ? "AMP_SETTLE_LIVE is set but the AMP adapter is still a stub — hop debit stays XPay until a proven adapter lands."
        : "AMP settle is PARKED. Default live hop is XPay (Base USDC / x402). See AMP sandbox recipe.",
      docs_url: AMP_SETTLE_DOCS,
      milestone_url: AMP_MILESTONE_DOCS,
      feature_flag: {
        name: AMP_SETTLE_LIVE_ENV,
        value: liveFlag,
        note: "Default false. Setting true does not enable AMP while only this stub exists.",
      },
    },
  };
}
