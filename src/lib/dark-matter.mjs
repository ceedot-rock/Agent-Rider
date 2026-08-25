/**
 * Lab Dark Matter Kernel — multi-state residual memory
 * ─────────────────────────────────────────────────────
 * Schema: spl.dark-matter.v1
 *
 * Law:
 *   - Storage holds ALL open possibilities (paths), not only current computestate.
 *   - Current computestate is a *readout*; the pack is the substance.
 *   - Actions live SUPERSuspended until release (open-path computation).
 *   - Only code residual of path novelty; commit costs mirror residual.
 *   - Integrity stitch on pack; HALT on tamper.
 *
 * Public enablement shape only — no private production coefficients.
 * Secular commercial surface for product UIs; lab docs may use full language.
 *
 * © Slid Phi Labs / SPLabs — internal kernel, vendored into lab apps.
 */

export const DARK_MATTER = {
  schema: "spl.dark-matter.v1",
  magic: "SPLDM1",
  law: "readout≠substance · suspend before side-effect · residual+cost · stitch or HALT",
  name: "multi-state dark-matter memory",
};

/** @typedef {"ALLOW"|"THROTTLE"|"BLOCK"|"SUGGEST_ALT"} Verdict */
/** @typedef {"suspended"|"released"|"cancelled"|"superseded"|"expired"} PathStatus */

/**
 * @typedef {object} SuspendedAct
 * @property {string} id
 * @property {string} kind
 * @property {string} path
 * @property {number} residual
 * @property {number} cost
 * @property {Verdict} verdict
 * @property {unknown} [payload]
 * @property {PathStatus} status
 * @property {string} createdAt
 * @property {string} [releasedAt]
 * @property {string} [reason]
 * @property {string} [app]
 * @property {string} [process]
 */

/**
 * @typedef {object} DarkMatterPack
 * @property {string} magic
 * @property {1} v
 * @property {string} schema
 * @property {string} app
 * @property {string} process
 * @property {unknown} readout          // current computestate only
 * @property {SuspendedAct[]} paths     // all open / historical suspended acts
 * @property {{ residualSum: number, costSum: number, open: number, released: number, blocked: number }} field
 * @property {string} stitch
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Record<string, unknown>} [meta]
 */

const te = () => new TextEncoder();

/** Simple FNV-1a 32 + length — portable stitch (no crypto required for path store).
 *  Apps may upgrade to SHA-256 in Chamber layer. */
export function stitchMaterial(parts) {
  const s = parts.join("\0");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a32:${(h >>> 0).toString(16).padStart(8, "0")}:len:${s.length}`;
}

export function packStitch(pack) {
  const pathIds = (pack.paths || [])
    .map((p) => `${p.id}:${p.status}:${p.verdict}:${p.residual}`)
    .join("|");
  return stitchMaterial([
    pack.magic || DARK_MATTER.magic,
    pack.schema || DARK_MATTER.schema,
    pack.app || "",
    pack.process || "",
    JSON.stringify(pack.readout ?? null),
    pathIds,
    String(pack.field?.residualSum ?? 0),
    String(pack.field?.open ?? 0),
  ]);
}

export function verifyPack(pack) {
  if (!pack || pack.magic !== DARK_MATTER.magic) {
    return { ok: false, reason: "DARK MATTER HALT: bad magic" };
  }
  if (pack.schema !== DARK_MATTER.schema) {
    return { ok: false, reason: "DARK MATTER HALT: schema mismatch" };
  }
  const expect = packStitch(pack);
  if (pack.stitch !== expect) {
    return { ok: false, reason: "DARK MATTER HALT: stitch fail (pack tampered or desynced)" };
  }
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}

function uid(prefix = "path") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Public residual energy shape (enablement — not private coeffs). */
export function scorePathResidual(kind, payload = {}, priors = {}) {
  const k = String(kind || "unknown").toLowerCase();
  const prior = typeof priors[k] === "number" ? priors[k] : 0.45;
  const blob = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const spread = Math.min(0.4, blob.length / 500);
  // cheap φ-ish gap from kind length
  const phi = 1.618033988749895;
  const gap = Math.abs(((k.length * phi) % 1) - 0.5) * 0.2;
  const residual = Math.min(1, prior * 0.7 + spread + gap);
  const cost = residual; // mirrored: dE + dC ≈ 0 enablement
  return { residual, cost, mirrorError: Math.abs(residual - cost) };
}

/** Map residual → governance verdict. */
export function verdictFromResidual(residual, { hardBlock = 0.85, throttle = 0.55 } = {}) {
  if (residual >= hardBlock) return "BLOCK";
  if (residual >= throttle) return "THROTTLE";
  if (residual >= throttle - 0.12) return "SUGGEST_ALT";
  return "ALLOW";
}

/**
 * Create empty multi-state pack.
 * @param {{ app: string, process: string, readout?: unknown, meta?: object }} opts
 */
export function createPack(opts) {
  const pack = {
    magic: DARK_MATTER.magic,
    v: 1,
    schema: DARK_MATTER.schema,
    app: opts.app || "unknown",
    process: opts.process || "default",
    readout: opts.readout ?? null,
    paths: [],
    field: { residualSum: 0, costSum: 0, open: 0, released: 0, blocked: 0 },
    stitch: "",
    createdAt: now(),
    updatedAt: now(),
    meta: opts.meta || {},
  };
  pack.stitch = packStitch(pack);
  return pack;
}

function recomputeField(pack) {
  let residualSum = 0;
  let costSum = 0;
  let open = 0;
  let released = 0;
  let blocked = 0;
  for (const p of pack.paths) {
    residualSum += p.residual || 0;
    costSum += p.cost || 0;
    if (p.status === "suspended") open++;
    if (p.status === "released") released++;
    if (p.verdict === "BLOCK") blocked++;
  }
  pack.field = { residualSum, costSum, open, released, blocked };
  pack.updatedAt = now();
  pack.stitch = packStitch(pack);
  return pack;
}

/**
 * Open a path — supersuspend an action (does NOT mutate readout).
 * Open-path computation: score + store only.
 */
export function openPath(pack, { kind, payload, path, priors, app, process, forceVerdict } = {}) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  const scored = scorePathResidual(kind, payload, priors);
  const verdict = forceVerdict || verdictFromResidual(scored.residual);
  /** @type {SuspendedAct} */
  const act = {
    id: uid("p"),
    kind: String(kind || "act"),
    path: path || `open/${kind || "act"}`,
    residual: scored.residual,
    cost: scored.cost,
    verdict,
    payload: payload ?? null,
    status: "suspended",
    createdAt: now(),
    reason: `mirror_error=${scored.mirrorError.toFixed(6)}`,
    app: app || pack.app,
    process: process || pack.process,
  };
  pack.paths.push(act);
  return { pack: recomputeField(pack), act };
}

/**
 * Re-score open paths without release (open-path compute tick).
 */
export function rescoreOpen(pack, priors = {}) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  for (const p of pack.paths) {
    if (p.status !== "suspended") continue;
    const scored = scorePathResidual(p.kind, p.payload, priors);
    p.residual = scored.residual;
    p.cost = scored.cost;
    p.verdict = verdictFromResidual(scored.residual);
    p.reason = `rescore mirror_error=${scored.mirrorError.toFixed(6)}`;
  }
  return recomputeField(pack);
}

/**
 * Release one suspended path into readout via mutator.
 * Only ALLOW or THROTTLE may release (THROTTLE may still apply with flag).
 * BLOCK / SUGGEST_ALT stay suspended unless force.
 *
 * @param {DarkMatterPack} pack
 * @param {string} actId
 * @param {(readout: unknown, act: SuspendedAct) => unknown} apply
 * @param {{ allowThrottle?: boolean, force?: boolean }} [opts]
 */
export function releasePath(pack, actId, apply, opts = {}) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  const act = pack.paths.find((p) => p.id === actId);
  if (!act) throw new Error("DARK MATTER HALT: path not found");
  if (act.status !== "suspended") throw new Error(`DARK MATTER HALT: path not suspended (${act.status})`);

  const allow =
    opts.force ||
    act.verdict === "ALLOW" ||
    (opts.allowThrottle && act.verdict === "THROTTLE");

  if (!allow) {
    return {
      pack,
      act,
      released: false,
      reason: `verdict ${act.verdict} — path remains supersuspended`,
    };
  }

  const next = apply(pack.readout, act);
  pack.readout = next;
  act.status = "released";
  act.releasedAt = now();
  // supersede sibling open paths of same kind if requested later — leave open for multi-branch

  return { pack: recomputeField(pack), act, released: true, reason: "released" };
}

/** Cancel a suspended path (still retained as possibility-history). */
export function cancelPath(pack, actId, reason = "cancelled") {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  const act = pack.paths.find((p) => p.id === actId);
  if (!act) throw new Error("DARK MATTER HALT: path not found");
  if (act.status === "released") throw new Error("DARK MATTER HALT: cannot cancel released path");
  act.status = "cancelled";
  act.reason = reason;
  return recomputeField(pack);
}

/** List open (supersuspended) paths, optionally filtered. */
export function openPaths(pack, filter = {}) {
  return (pack.paths || []).filter((p) => {
    if (p.status !== "suspended") return false;
    if (filter.kind && p.kind !== filter.kind) return false;
    if (filter.verdict && p.verdict !== filter.verdict) return false;
    return true;
  });
}

/** Set readout without path release (load / migrate / external sync). */
export function setReadout(pack, readout) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  pack.readout = readout;
  pack.updatedAt = now();
  pack.stitch = packStitch(pack);
  return pack;
}

/** Compact: drop old cancelled/superseded beyond keepN (released stay for audit). */
export function compactPaths(pack, { keepCancelled = 32, keepReleased = 128 } = {}) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  const suspended = pack.paths.filter((p) => p.status === "suspended");
  const released = pack.paths.filter((p) => p.status === "released").slice(-keepReleased);
  const cancelled = pack.paths
    .filter((p) => p.status === "cancelled" || p.status === "superseded" || p.status === "expired")
    .slice(-keepCancelled);
  pack.paths = [...suspended, ...released, ...cancelled];
  return recomputeField(pack);
}

/** Serialize pack for storage (JSON). Chamber apps should seal this further. */
export function serializePack(pack) {
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  return JSON.stringify(pack);
}

export function deserializePack(json) {
  const pack = typeof json === "string" ? JSON.parse(json) : json;
  const v = verifyPack(pack);
  if (!v.ok) throw new Error(v.reason);
  return pack;
}

/** Human footer note */
export function packStats(pack) {
  const f = pack.field || {};
  return `DarkMatter ${pack.app}/${pack.process} open=${f.open ?? 0} rel=${f.released ?? 0} RΣ=${(f.residualSum ?? 0).toFixed(2)}`;
}

/**
 * Process wrapper: treat any side-effectful call as open-path first.
 * Returns either immediate release result or suspended act.
 */
export function processAct(pack, actSpec, apply, opts = {}) {
  const { pack: p2, act } = openPath(pack, actSpec);
  if (act.verdict === "BLOCK" && !opts.force) {
    return { pack: p2, act, released: false, reason: "BLOCK — supersuspended" };
  }
  if (act.verdict === "SUGGEST_ALT" && !opts.force && !opts.releaseSuggest) {
    return { pack: p2, act, released: false, reason: "SUGGEST_ALT — supersuspended (pick alt)" };
  }
  if (act.verdict === "THROTTLE" && !opts.allowThrottle && !opts.force) {
    return { pack: p2, act, released: false, reason: "THROTTLE — supersuspended pending ACK" };
  }
  return releasePath(p2, act.id, apply, opts);
}

export default {
  DARK_MATTER,
  createPack,
  openPath,
  rescoreOpen,
  releasePath,
  cancelPath,
  openPaths,
  setReadout,
  compactPaths,
  serializePack,
  deserializePack,
  verifyPack,
  packStitch,
  scorePathResidual,
  verdictFromResidual,
  processAct,
  packStats,
};
