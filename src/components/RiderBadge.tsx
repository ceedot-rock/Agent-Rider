"use client";

import { useEffect, useState } from "react";

// Ported from AgentNet's rider-badge.tsx, which was wired to the wrong
// endpoint shape entirely — it POSTed a self-submitted `credential_id` to
// `/api/verify` (that route is the *merchant-key* check, not identity
// verification) and stored a one-time `rider_verified` boolean on a Supabase
// Auth profile. None of that matches how identity actually works here:
// agent_id itself is the credential, there's nothing separate to submit,
// and reputation is live, not a stored stamp from whenever verification
// last ran. This fetches the real signed trust badge (src/lib/badge.ts,
// GET /api/agents/{id}/badge — built for task #7) and shows identity +
// live reputation together, which is what task #6 actually asked for.

interface TrustBadgeTrust {
  chain_length: number;
  chain_valid: boolean;
  blended_trust_score: number;
  tasks_completed: number;
  credits: number;
}

interface TrustBadgeResponse {
  badge: {
    agent: { id: string; name: string; type: string };
    trust: TrustBadgeTrust;
  };
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; name: string; trust: TrustBadgeTrust };

export function RiderBadge({ agentId, className }: { agentId: string; className?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch(`/api/agents/${encodeURIComponent(agentId)}/badge`)
      .then((res) => (res.ok ? (res.json() as Promise<TrustBadgeResponse>) : Promise.reject(res.status)))
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", name: data.badge.agent.name, trust: data.badge.trust });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const base =
    "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider";

  if (state.status === "loading") {
    return <span className={`${base} border-muted-foreground/20 text-muted-foreground/60 ${className ?? ""}`}>…</span>;
  }

  if (state.status === "error") {
    return (
      <span
        className={`${base} border-muted-foreground/30 text-muted-foreground ${className ?? ""}`}
        title="No Agent^Rider identity on file"
      >
        Unverified
      </span>
    );
  }

  const trusted = state.trust.blended_trust_score >= 50 && state.trust.chain_valid;

  return (
    <span
      className={`${base} ${trusted ? "border-primary/40 bg-primary/10 text-primary" : "border-amber-500/40 bg-amber-500/10 text-amber-600"} ${className ?? ""}`}
      title={`${state.name} — trust score ${state.trust.blended_trust_score}/100, ${state.trust.tasks_completed} tasks completed, PoW chain ${state.trust.chain_valid ? "valid" : "broken"}`}
    >
      Rider {state.trust.blended_trust_score}
    </span>
  );
}
