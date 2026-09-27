/**
 * Toll 2 — pure capability validation + lookup filter (no DB).
 * Importable by Node selftests; TypeScript re-exports via capabilities.ts.
 */

export const EVIDENCE_LEVELS = Object.freeze([
  "L0_self",
  "L1_receipt",
  "L2_exactness",
  "L3_attest",
]);

export const EVIDENCE_KINDS = Object.freeze([
  "self_asserted",
  "rider_receipt",
  "cuni_exactness",
  "host_attest",
]);

export const VERIFIED_EVIDENCE_LEVELS = new Set([
  "L1_receipt",
  "L2_exactness",
  "L3_attest",
]);

export const EVIDENCE_LEVEL_WEIGHT = Object.freeze({
  L0_self: 0,
  L1_receipt: 0.4,
  L2_exactness: 0.7,
  L3_attest: 1.0,
});

export function isEvidenceLevel(v) {
  return typeof v === "string" && EVIDENCE_LEVELS.includes(v);
}

export function isEvidenceKind(v) {
  return typeof v === "string" && EVIDENCE_KINDS.includes(v);
}

export function defaultLevelForKind(kind) {
  switch (kind) {
    case "self_asserted":
      return "L0_self";
    case "rider_receipt":
      return "L1_receipt";
    case "cuni_exactness":
      return "L2_exactness";
    case "host_attest":
      return "L3_attest";
    default:
      return "L0_self";
  }
}

export function isVerifiedEvidenceLevel(level) {
  return VERIFIED_EVIDENCE_LEVELS.has(level);
}

/** L3_attest is schema-ok but PARKED until host attestation LIVE. */
export function honestyForLevel(level) {
  if (level === "L3_attest") {
    return {
      live: false,
      parked_note:
        "L3_attest / host_attest is PARKED until host attestation is LIVE. Stored in schema; not a live verified badge today.",
    };
  }
  return { live: true, parked_note: null };
}

export function validateCapabilityUpsert(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_body", detail: "JSON object required" };
  }
  const b = body;

  if (typeof b.agent_id !== "string" || !b.agent_id.trim()) {
    return { ok: false, error: "missing_agent_id" };
  }
  if (typeof b.name !== "string" || !b.name.trim()) {
    return { ok: false, error: "missing_name" };
  }

  const evidenceIn = b.evidence && typeof b.evidence === "object" ? b.evidence : {};
  const kind = isEvidenceKind(evidenceIn.kind) ? evidenceIn.kind : "self_asserted";

  const trustIn = b.trust && typeof b.trust === "object" ? b.trust : {};
  const evidence_level = isEvidenceLevel(trustIn.evidence_level)
    ? trustIn.evidence_level
    : defaultLevelForKind(kind);

  if (kind === "host_attest" && evidence_level !== "L3_attest") {
    return {
      ok: false,
      error: "evidence_mismatch",
      detail: "host_attest requires trust.evidence_level L3_attest",
    };
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t) => typeof t === "string" && t.trim().length > 0)
    : [];
  const interfaces = Array.isArray(b.interfaces) ? b.interfaces : [];

  return {
    ok: true,
    value: {
      capability_id: typeof b.capability_id === "string" ? b.capability_id : undefined,
      agent_id: b.agent_id.trim(),
      name: b.name.trim(),
      summary: typeof b.summary === "string" ? b.summary : "",
      tags,
      interfaces,
      evidence: {
        kind,
        refs: Array.isArray(evidenceIn.refs)
          ? evidenceIn.refs.filter((r) => typeof r === "string")
          : [],
        verified_at: typeof evidenceIn.verified_at === "string" ? evidenceIn.verified_at : null,
        expires_at: typeof evidenceIn.expires_at === "string" ? evidenceIn.expires_at : null,
      },
      trust: {
        agent_trust_score:
          typeof trustIn.agent_trust_score === "number" ? trustIn.agent_trust_score : null,
        evidence_level,
      },
      honesty: honestyForLevel(evidence_level),
    },
  };
}

function normalizeMinEvidence(v) {
  return isEvidenceLevel(v) ? v : "L1_receipt";
}

export function rankScore(cap) {
  const trustRaw = Number(cap.trust?.agent_trust_score ?? 0);
  const trustNorm = Math.max(0, Math.min(1, trustRaw / 100));
  const ev = EVIDENCE_LEVEL_WEIGHT[cap.trust?.evidence_level ?? "L0_self"] ?? 0;
  const promotedBoost = cap.placement?.promoted ? 1 : 0;
  return 0.5 * trustNorm + 0.3 * ev + 0.2 * promotedBoost;
}

function textMatch(cap, q) {
  if (!q.trim()) return true;
  const hay = `${cap.name} ${cap.summary} ${(cap.tags ?? []).join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

function levelRank(level) {
  return EVIDENCE_LEVELS.indexOf(level);
}

/**
 * Filter + rank for lookup.
 * L0_self is never verified:true. verified_only excludes L0 from results.
 */
export function filterAndRankCapabilities(caps, query) {
  const minEv = normalizeMinEvidence(query.min_evidence);
  const limit = Math.max(1, Math.min(50, query.limit ?? 10));
  const tags = (query.tags ?? []).map((t) => t.toLowerCase());
  const q = query.query ?? "";

  const matches = [];
  for (const cap of caps) {
    const level = cap.trust?.evidence_level ?? "L0_self";
    if (levelRank(level) < levelRank(minEv)) continue;
    if (query.verified_only && !isVerifiedEvidenceLevel(level)) continue;
    if (tags.length > 0) {
      const capTags = (cap.tags ?? []).map((t) => t.toLowerCase());
      if (!tags.every((t) => capTags.includes(t))) continue;
    }
    if (!textMatch(cap, q)) continue;

    const verified = isVerifiedEvidenceLevel(level) && level !== "L0_self";
    matches.push({
      capability_id: cap.capability_id,
      agent_id: cap.agent_id,
      name: cap.name,
      summary: cap.summary,
      tags: cap.tags ?? [],
      interfaces: cap.interfaces ?? [],
      evidence_level: level,
      verified,
      score: rankScore(cap),
      promoted: Boolean(cap.placement?.promoted),
      honesty: cap.honesty ?? honestyForLevel(level),
    });
  }

  matches.sort((a, b) => b.score - a.score || a.capability_id.localeCompare(b.capability_id));
  return matches.slice(0, limit);
}

/** Flag helpers for selftests (mirror toll-flags.ts). */
export function envFlagOn(name, env = process.env) {
  const v = String(env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function isToll1MeterLive(env = process.env) {
  return envFlagOn("TOLL1_METER_LIVE", env);
}
export function isToll2LookupLive(env = process.env) {
  return envFlagOn("TOLL2_LOOKUP_LIVE", env);
}
export function isToll2PromoteLive(env = process.env) {
  return envFlagOn("TOLL2_PROMOTE_LIVE", env);
}
