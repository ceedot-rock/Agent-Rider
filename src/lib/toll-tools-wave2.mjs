/**
 * Toll Tools wave 2 — ExactOdds proxy core (draw + resolve).
 *
 * UPSTREAM CONTRACT (verified live 2026-10-08 against
 * https://exactodds-api.fly.dev, source at ~/workspace/exactodds/api/server.js):
 *
 *   GET  /health                       -> { ok:true, service:"exactodds-api" }
 *   GET  /v1/programs                  -> { ok:true, programs: { <slug>: { functions:[{name,params}] } } }
 *   POST /v1/<program>/<function>      -> JSON body whose EVERY param must be a
 *                                          safe integer (upstream 400s otherwise);
 *                                          returns { ok:true, result, program,
 *                                          function, seat, source_hash }.
 *
 *   Verified draw-type routes (live):
 *     POST /v1/provably-fair-dice/roll_dice        {server_seed,client_seed,round} -> {ok:true,result:3,...}
 *     POST /v1/provably-fair-coin-flip/flip        {server_seed,client_seed,round}
 *     POST /v1/provably-fair-roulette/spin         {server_seed,client_seed,round}
 *     POST /v1/provably-fair-crash/crash_point     {server_seed,client_seed,round}
 *   Verified settle-type routes (live):
 *     POST /v1/casino-baccarat-settle/baccarat_settle {stake_cents,bet_on,winner} -> {ok:true,result:0,...}
 *     POST /v1/casino-sportsbook-settlement/settle_moneyline {stake_cents,american_odds,result}
 *     POST /v1/provably-fair-crash/settle_crash {bet_cents,cashout_hundredths,crash_hundredths}
 *
 * ADAPTER (honest, documented — no upstream behavior is invented):
 * The toll tool speaks { game_id, draw_id?, count? } while the upstream
 * speaks integer seeds. The adapter maps a fixed game catalog to upstream
 * draw functions and derives the integer seeds DETERMINISTICALLY with
 * sha256 over the caller-supplied ids:
 *
 *   server_seed = sha256("exactodds-draw:v1:server:" + game_id)        mod 2^53
 *   client_seed = sha256("exactodds-draw:v1:client:" + draw_id-or-game) mod 2^53
 *   round       = 1..count
 *
 * Every result byte comes from a real upstream call. Same (game_id, draw_id)
 * always replays the same upstream params, so draw_id is a genuine
 * idempotency key — no upstream state is assumed or fabricated.
 *
 * RESOLVE SEMANTICS (documented limitation): the upstream settle functions
 * require caller-supplied stake/outcome integers (stake_cents, bet_on,
 * winner, ...) which the published tool schema { game_id, draw_id } does not
 * carry. Inventing those values would fake the upstream, so the resolve tool
 * does NOT call a settle route: for provably-fair games the outcome IS the
 * settlement, and resolve returns the canonical outcome obtained by
 * re-executing the exact upstream draw call for (game_id, draw_id) —
 * deterministic, verifiable, zero invented inputs. To proxy the true
 * stake-based settle routes (baccarat_settle, settle_moneyline,
 * settle_crash), the schema must grow stake/outcome params — noted, not
 * built here.
 *
 * Failure policy (fail closed): network/timeout/5xx -> 503
 * "exactodds_unavailable"; upstream 4xx / non-JSON / {ok:false} / missing
 * result -> 503 "exactodds_bad_response". Garbage is never passed through.
 *
 * No secrets, no money movement — pure read/compute proxy.
 */

import { createHash } from "node:crypto";

/** Upstream base. Overridable for tests via EXACTODDS_BASE. */
export const UPSTREAM_BASE = "https://exactodds-api.fly.dev";

export function upstreamBase() {
  return (process.env.EXACTODDS_BASE || UPSTREAM_BASE).replace(/\/+$/, "");
}

/** Upstream timeout for tool calls (ms). The routes use 15_000. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Game catalog: toll-facing game_id -> real upstream draw function.
 * Only functions with the uniform (server_seed, client_seed, round)
 * signature are admitted, so the deterministic seed adapter always fits.
 */
export const DRAW_GAMES = {
  "coin-flip": { program: "provably-fair-coin-flip", fn: "flip" },
  dice: { program: "provably-fair-dice", fn: "roll_dice" },
  roulette: { program: "provably-fair-roulette", fn: "spin" },
  crash: { program: "provably-fair-crash", fn: "crash_point" },
};

/** Dependency failure from the ExactOdds upstream. Carries .code/.status. */
export class ExactOddsUpstreamError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "ExactOddsUpstreamError";
    this.code = code;
    this.status = status;
  }
}

// ── canonical JSON + hashing ─────────────────────────────────────────────

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]))
      .join(",") +
    "}"
  );
}

export function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Deterministic integer seed < 2^53 from a tag + string. */
export function deriveSeedInt(tag, s) {
  const h = createHash("sha256").update(tag + ":" + s, "utf8").digest();
  return Number(h.readBigUInt64BE(0) % 9007199254740991n);
}

/** Seeds + canonical draw_id for a (game_id, draw_id) pair. Exported for tests. */
export function deriveDrawParams(game_id, draw_id) {
  const canonical_draw_id =
    draw_id ??
    "draw_" + sha256Hex(canonicalJson({ game_id })).slice(0, 16);
  return {
    draw_id: canonical_draw_id,
    server_seed: deriveSeedInt("exactodds-draw:v1:server", game_id),
    client_seed: deriveSeedInt("exactodds-draw:v1:client", canonical_draw_id),
  };
}

// ── upstream fetch with timeout ──────────────────────────────────────────

/**
 * POST JSON to the upstream with an AbortController timeout.
 * Throws ExactOddsUpstreamError("exactodds_unavailable" | "exactodds_bad_response").
 */
export async function fetchUpstream(path, body, { timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(upstreamBase() + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ExactOddsUpstreamError(
      "exactodds_unavailable",
      `exactodds upstream unreachable: ${err && err.message ? err.message : err}`,
      503
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) {
    throw new ExactOddsUpstreamError(
      "exactodds_unavailable",
      `exactodds upstream HTTP ${res.status}`,
      503
    );
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ExactOddsUpstreamError("exactodds_bad_response", "exactodds upstream returned non-JSON", 503);
  }
  if (res.status >= 400 || !json || json.ok !== true || typeof json.result === "undefined") {
    throw new ExactOddsUpstreamError(
      "exactodds_bad_response",
      `exactodds upstream bad response (http ${res.status}, ok=${json && json.ok})`,
      503
    );
  }
  return json;
}

/** One upstream draw round. Returns the verified upstream envelope fields. */
export async function upstreamDrawRound(game, server_seed, client_seed, round, opts) {
  const json = await fetchUpstream(
    `/v1/${game.program}/${game.fn}`,
    { server_seed, client_seed, round },
    opts
  );
  return {
    round,
    result: json.result,
    program: json.program,
    function: json.function,
    seat: json.seat,
    source_hash: json.source_hash,
  };
}

// ── validators ───────────────────────────────────────────────────────────
// Return { ok:true, value } | { ok:false, code, reason }.

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function unknownGameReason(game_id) {
  return `unknown game_id '${game_id}'; known games: ${Object.keys(DRAW_GAMES).join(", ")}`;
}

/**
 * @param {unknown} body
 * @returns {{ok: true, value: {game_id: string, draw_id: string|null, count: number}} | {ok: false, code: string, reason: string}}
 */
export function validateExactoddsDraw(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "malformed_tool_request", reason: "body must be a JSON object" };
  }
  const { game_id, draw_id, count } = body;
  if (!isNonEmptyString(game_id)) {
    return { ok: false, code: "missing_game_id", reason: "game_id (string) is required" };
  }
  if (!DRAW_GAMES[game_id]) {
    return { ok: false, code: "unknown_game", reason: unknownGameReason(game_id) };
  }
  if (draw_id !== undefined && !isNonEmptyString(draw_id)) {
    return { ok: false, code: "bad_draw_id", reason: "draw_id must be a non-empty string when provided" };
  }
  let n = 1;
  if (count !== undefined) {
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return { ok: false, code: "bad_count", reason: "count must be an integer 1..100" };
    }
    n = count;
  }
  return { ok: true, value: { game_id, draw_id: draw_id ?? null, count: n } };
}

/**
 * @param {unknown} body
 * @returns {{ok: true, value: {game_id: string, draw_id: string}} | {ok: false, code: string, reason: string}}
 */
export function validateExactoddsResolve(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "malformed_tool_request", reason: "body must be a JSON object" };
  }
  const { game_id, draw_id } = body;
  if (!isNonEmptyString(game_id)) {
    return { ok: false, code: "missing_game_id", reason: "game_id (string) is required" };
  }
  if (!DRAW_GAMES[game_id]) {
    return { ok: false, code: "unknown_game", reason: unknownGameReason(game_id) };
  }
  if (!isNonEmptyString(draw_id)) {
    return { ok: false, code: "missing_draw_id", reason: "draw_id (string) is required" };
  }
  return { ok: true, value: { game_id, draw_id } };
}

// ── runners (throw ExactOddsUpstreamError on dependency failure) ─────────

export async function runExactoddsDraw({ game_id, draw_id, count }, opts) {
  const game = DRAW_GAMES[game_id];
  const { draw_id: canonical_draw_id, server_seed, client_seed } = deriveDrawParams(
    game_id,
    draw_id ?? undefined
  );
  const results = [];
  for (let round = 1; round <= count; round++) {
    results.push(await upstreamDrawRound(game, server_seed, client_seed, round, opts));
  }
  const results_sha256 = sha256Hex(canonicalJson(results));
  const source_hash = results[0].source_hash;
  return {
    draw_id: canonical_draw_id,
    game_id,
    program: game.program,
    function: game.fn,
    count,
    results,
    results_sha256,
    source_hash,
    seat: results[0].seat,
  };
}

/**
 * Resolve (settle) a draw by re-executing its canonical upstream draw call.
 * For provably-fair games the outcome IS the settlement; re-execution is
 * deterministic in (game_id, draw_id), so the settled outcome is verifiable
 * against any earlier draw receipt. See module header for why the
 * stake-based settle routes are not proxied here.
 */
export async function runExactoddsResolve({ game_id, draw_id }, opts) {
  const game = DRAW_GAMES[game_id];
  const { server_seed, client_seed } = deriveDrawParams(game_id, draw_id);
  const round = await upstreamDrawRound(game, server_seed, client_seed, 1, opts);
  const outcome_sha256 = sha256Hex(canonicalJson(round.result));
  return {
    draw_id,
    game_id,
    program: game.program,
    function: game.fn,
    settled: true,
    settlement: "reexecution",
    outcome: round.result,
    outcome_sha256,
    source_hash: round.source_hash,
    seat: round.seat,
    settled_at: Math.floor(Date.now() / 1000),
  };
}

// ── receipt detail builders (shape-tested, used by the routes) ───────────

export function drawDetailOf(out) {
  return {
    draw_id: out.draw_id,
    game_id: out.game_id,
    upstream_program: out.program,
    upstream_function: out.function,
    count: out.count,
    results: out.results,
    results_sha256: out.results_sha256,
    source_hash: out.source_hash,
  };
}

export function resolveDetailOf(out) {
  return {
    draw_id: out.draw_id,
    game_id: out.game_id,
    upstream_program: out.program,
    upstream_function: out.function,
    settled: out.settled,
    settlement: out.settlement,
    outcome: out.outcome,
    outcome_sha256: out.outcome_sha256,
    source_hash: out.source_hash,
  };
}
