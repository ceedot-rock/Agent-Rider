/**
 * Narrow warrant — spend may only shrink.
 *
 * Lab-owned. Biscuit's idea (offline attenuation, never widen), our token.
 * Authority names an agent and a cap in integer cents. Each hop must lower
 * max_cents and not extend until. Delegatee presents the full chain; stripping
 * to an earlier hop would impersonate that hop's agent_id, which they are not.
 *
 * Law: cuni/examples/laws/spend-control.cuni — amount <= cap.
 */

export type WarrantBody = {
  agent_id: string;
  max_cents: number;
  until: number;
};

export type Warrant = {
  v: 1;
  kind: "spl-narrow";
  authority: WarrantBody;
  hops: WarrantBody[];
};

function intCents(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error("warrant_cents");
  }
  return n;
}

function intUntil(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error("warrant_until");
  }
  return n;
}

function body(raw: WarrantBody): WarrantBody {
  if (!raw || typeof raw.agent_id !== "string" || !raw.agent_id) {
    throw new Error("warrant_agent");
  }
  return {
    agent_id: raw.agent_id,
    max_cents: intCents(raw.max_cents),
    until: intUntil(raw.until),
  };
}

export function issueWarrant(authority: WarrantBody): Warrant {
  return { v: 1, kind: "spl-narrow", authority: body(authority), hops: [] };
}

function last(w: Warrant): WarrantBody {
  return w.hops.length ? w.hops[w.hops.length - 1] : w.authority;
}

export function attenuate(w: Warrant, next: WarrantBody): Warrant {
  if (!w || w.kind !== "spl-narrow" || w.v !== 1) {
    throw new Error("warrant_kind");
  }
  const hop = body(next);
  const prev = last(w);
  if (hop.max_cents > prev.max_cents) {
    throw new Error("warrant_widen_cents");
  }
  if (hop.until > prev.until) {
    throw new Error("warrant_widen_until");
  }
  return { ...w, hops: [...w.hops, hop] };
}

export function verifyWarrant(
  w: Warrant,
  nowUnix = Math.floor(Date.now() / 1000)
): { ok: true; body: WarrantBody } | { ok: false; error: string } {
  try {
    if (!w || w.kind !== "spl-narrow" || w.v !== 1) {
      return { ok: false, error: "warrant_kind" };
    }
    const chain = [body(w.authority), ...w.hops.map(body)];
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].max_cents > chain[i - 1].max_cents) {
        return { ok: false, error: "warrant_widen_cents" };
      }
      if (chain[i].until > chain[i - 1].until) {
        return { ok: false, error: "warrant_widen_until" };
      }
    }
    const cur = chain[chain.length - 1];
    if (nowUnix >= cur.until) {
      return { ok: false, error: "warrant_expired" };
    }
    return { ok: true, body: cur };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "warrant_invalid" };
  }
}

/** Remaining cap in integer cents — spend-control.cuni. */
export function remainingCents(w: Warrant): number {
  const v = verifyWarrant(w);
  return v.ok ? v.body.max_cents : 0;
}

export function parseWarrant(raw: unknown): Warrant | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "spl-narrow" || o.v !== 1) return null;
  if (!o.authority || typeof o.authority !== "object") return null;
  if (!Array.isArray(o.hops)) return null;
  try {
    return {
      v: 1,
      kind: "spl-narrow",
      authority: body(o.authority as WarrantBody),
      hops: (o.hops as WarrantBody[]).map(body),
    };
  } catch {
    return null;
  }
}
