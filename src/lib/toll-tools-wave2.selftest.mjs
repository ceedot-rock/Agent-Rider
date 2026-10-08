/**
 * Toll Tools wave 2 (ExactOdds) selftest — validators, constants, upstream
 * route verification, timeout handling, receipt-detail shape.
 * Run: cd src && npm run selftest:toll-tools-2
 *
 * Live upstream assertions hit https://exactodds-api.fly.dev (read-only,
 * no money). If the upstream is unreachable at run time those assertions
 * are SKIPPED with a clear note — never faked.
 */
import assert from "node:assert/strict";
import http from "node:http";
import {
  UPSTREAM_BASE,
  UPSTREAM_TIMEOUT_MS,
  DRAW_GAMES,
  ExactOddsUpstreamError,
  upstreamBase,
  canonicalJson,
  sha256Hex,
  deriveSeedInt,
  deriveDrawParams,
  fetchUpstream,
  validateExactoddsDraw,
  validateExactoddsResolve,
  runExactoddsDraw,
  runExactoddsResolve,
  drawDetailOf,
  resolveDetailOf,
} from "./toll-tools-wave2.mjs";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { n++; assert.equal(a, b, msg); };
const deepEq = (a, b, msg) => { n++; assert.deepEqual(a, b, msg); };

// ── validators: exactodds-draw ───────────────────────────────────────────
{
  const v = validateExactoddsDraw({ game_id: "dice" });
  eq(v.ok, true, "draw: minimal good body validates");
  deepEq(v.value, { game_id: "dice", draw_id: null, count: 1 }, "draw: defaults (count=1, draw_id=null)");

  const v2 = validateExactoddsDraw({ game_id: "coin-flip", draw_id: "d1", count: 100 });
  eq(v2.ok, true, "draw: full good body validates");
  eq(v2.value.count, 100, "draw: count=100 accepted");

  eq(validateExactoddsDraw(null).code, "malformed_tool_request", "draw: null body");
  eq(validateExactoddsDraw([1]).code, "malformed_tool_request", "draw: array body");
  eq(validateExactoddsDraw({}).code, "missing_game_id", "draw: missing game_id");
  eq(validateExactoddsDraw({ game_id: 42 }).code, "missing_game_id", "draw: non-string game_id");
  eq(validateExactoddsDraw({ game_id: "   " }).code, "missing_game_id", "draw: blank game_id");
  const ug = validateExactoddsDraw({ game_id: "slots" });
  eq(ug.ok, false, "draw: unknown game rejected");
  eq(ug.code, "unknown_game", "draw: unknown_game code");
  eq(validateExactoddsDraw({ game_id: "dice", count: 0 }).code, "bad_count", "draw: count=0");
  eq(validateExactoddsDraw({ game_id: "dice", count: 101 }).code, "bad_count", "draw: count=101");
  eq(validateExactoddsDraw({ game_id: "dice", count: 1.5 }).code, "bad_count", "draw: count=1.5");
  eq(validateExactoddsDraw({ game_id: "dice", count: "3" }).code, "bad_count", "draw: count string");
  eq(validateExactoddsDraw({ game_id: "dice", draw_id: "" }).code, "bad_draw_id", "draw: empty draw_id");
  eq(validateExactoddsDraw({ game_id: "dice", draw_id: 42 }).code, "bad_draw_id", "draw: numeric draw_id");
}

// ── validators: exactodds-resolve ────────────────────────────────────────
{
  const v = validateExactoddsResolve({ game_id: "roulette", draw_id: "d9" });
  eq(v.ok, true, "resolve: good body validates");
  deepEq(v.value, { game_id: "roulette", draw_id: "d9" }, "resolve: value passthrough");

  eq(validateExactoddsResolve(null).code, "malformed_tool_request", "resolve: null body");
  eq(validateExactoddsResolve({ draw_id: "d9" }).code, "missing_game_id", "resolve: missing game_id");
  eq(validateExactoddsResolve({ game_id: "nope", draw_id: "d9" }).code, "unknown_game", "resolve: unknown game");
  eq(validateExactoddsResolve({ game_id: "dice" }).code, "missing_draw_id", "resolve: missing draw_id");
  eq(validateExactoddsResolve({ game_id: "dice", draw_id: "" }).code, "missing_draw_id", "resolve: empty draw_id");
}

// ── constants / helpers ──────────────────────────────────────────────────
{
  eq(UPSTREAM_BASE, "https://exactodds-api.fly.dev", "UPSTREAM_BASE constant");
  eq(UPSTREAM_TIMEOUT_MS, 15000, "upstream timeout is 15s");
  deepEq(Object.keys(DRAW_GAMES).sort(), ["coin-flip", "crash", "dice", "roulette"], "game catalog");
  eq(DRAW_GAMES.dice.program, "provably-fair-dice", "dice maps to real upstream program");
  eq(DRAW_GAMES.dice.fn, "roll_dice", "dice maps to real upstream function");

  const prev = process.env.EXACTODDS_BASE;
  process.env.EXACTODDS_BASE = "http://localhost:9999/";
  eq(upstreamBase(), "http://localhost:9999", "EXACTODDS_BASE override respected (trailing slash trimmed)");
  if (prev === undefined) delete process.env.EXACTODDS_BASE; else process.env.EXACTODDS_BASE = prev;

  eq(canonicalJson({ b: 1, a: [3, 2] }), canonicalJson({ a: [3, 2], b: 1 }), "canonicalJson key-order stable");
  eq(sha256Hex("abc").length, 64, "sha256Hex is 64 hex chars");

  const s1 = deriveSeedInt("t", "x"), s2 = deriveSeedInt("t", "x"), s3 = deriveSeedInt("u", "x");
  eq(s1, s2, "deriveSeedInt deterministic");
  ok(s1 !== s3, "deriveSeedInt differs by tag");
  ok(Number.isSafeInteger(s1) && s1 >= 0, "deriveSeedInt is a safe non-negative integer");

  const p1 = deriveDrawParams("dice", "d-1"), p2 = deriveDrawParams("dice", "d-1");
  deepEq(p1, p2, "deriveDrawParams deterministic");
  eq(p1.draw_id, "d-1", "deriveDrawParams keeps provided draw_id");
  ok(deriveDrawParams("dice", undefined).draw_id.startsWith("draw_"), "default draw_id derived");

  const det = drawDetailOf({ draw_id: "d", game_id: "dice", program: "p", function: "f", count: 1, results: [], results_sha256: "h", source_hash: "s" });
  ok(det.draw_id === "d" && typeof det.results_sha256 === "string", "drawDetailOf carries draw_id + results sha256");
  const rdet = resolveDetailOf({ draw_id: "d", game_id: "dice", program: "p", function: "f", settled: true, settlement: "reexecution", outcome: 3, outcome_sha256: "h", source_hash: "s" });
  ok(rdet.settled === true && rdet.settlement === "reexecution", "resolveDetailOf carries settlement fields");
}

// ── failure handling: unreachable / timeout / malformed (local stubs) ───
const withBase = async (base, fn) => {
  const prev = process.env.EXACTODDS_BASE;
  process.env.EXACTODDS_BASE = base;
  try { await fn(); } finally {
    if (prev === undefined) delete process.env.EXACTODDS_BASE; else process.env.EXACTODDS_BASE = prev;
  }
};
const listenOn = (handler) => new Promise((resolve) => {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});
const closeSrv = (srv) => new Promise((r) => srv.close(r));

{
  // refused connection -> exactodds_unavailable (503), fail closed
  await withBase("http://127.0.0.1:9", async () => {
    try {
      await runExactoddsDraw({ game_id: "dice", draw_id: null, count: 1 }, { timeoutMs: 5000 });
      assert.fail("should have thrown");
    } catch (err) {
      n++; assert.ok(err instanceof ExactOddsUpstreamError, "refused conn: ExactOddsUpstreamError");
      eq(err.code, "exactodds_unavailable", "refused conn: code exactodds_unavailable");
      eq(err.status, 503, "refused conn: status 503");
    }
  });

  // hanging server -> AbortController timeout -> exactodds_unavailable
  const hang = await listenOn(() => {});
  await withBase(`http://127.0.0.1:${hang.address().port}`, async () => {
    const t0 = Date.now();
    try {
      await fetchUpstream("/v1/provably-fair-dice/roll_dice", { server_seed: 1, client_seed: 2, round: 1 }, { timeoutMs: 400 });
      assert.fail("should have timed out");
    } catch (err) {
      n++; assert.ok(err instanceof ExactOddsUpstreamError, "hang: ExactOddsUpstreamError");
      eq(err.code, "exactodds_unavailable", "hang: code exactodds_unavailable");
      ok(Date.now() - t0 < 5000, "hang: aborted near the 400ms timeout, not the TCP default");
    }
  });
  await closeSrv(hang);

  // non-JSON garbage -> exactodds_bad_response (never passed through)
  const garbage = await listenOn((req, res) => { res.end("this is not json"); });
  await withBase(`http://127.0.0.1:${garbage.address().port}`, async () => {
    try {
      await runExactoddsDraw({ game_id: "dice", draw_id: null, count: 1 }, { timeoutMs: 5000 });
      assert.fail("should have thrown");
    } catch (err) {
      n++; assert.ok(err instanceof ExactOddsUpstreamError, "garbage: ExactOddsUpstreamError");
      eq(err.code, "exactodds_bad_response", "garbage: code exactodds_bad_response");
      eq(err.status, 503, "garbage: status 503");
    }
  });
  await closeSrv(garbage);

  // upstream {ok:false} -> exactodds_bad_response
  const okFalse = await listenOn((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "nope" }));
  });
  await withBase(`http://127.0.0.1:${okFalse.address().port}`, async () => {
    try {
      await runExactoddsResolve({ game_id: "dice", draw_id: "d" }, { timeoutMs: 5000 });
      assert.fail("should have thrown");
    } catch (err) {
      n++; assert.ok(err instanceof ExactOddsUpstreamError, "ok:false ExactOddsUpstreamError");
      eq(err.code, "exactodds_bad_response", "ok:false -> exactodds_bad_response");
    }
  });
  await closeSrv(okFalse);
}

// ── live upstream verification (skipped honestly if unreachable) ─────────
let liveSkipped = 0;
let live = false;
try {
  const res = await fetch(UPSTREAM_BASE + "/health", { signal: AbortSignal.timeout(10000) });
  const h = await res.json();
  if (h && h.ok === true && h.service === "exactodds-api") live = true;
} catch { /* unreachable -> skip below */ }

if (!live) {
  liveSkipped = 6;
  console.log("SKIP (upstream unreachable): 6 live upstream assertions skipped — exactodds-api.fly.dev not reachable from this run");
} else {
  // draw route: real shape
  {
    const res = await fetch(UPSTREAM_BASE + "/v1/provably-fair-dice/roll_dice", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ server_seed: 12345, client_seed: 678, round: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    eq(j.ok, true, "live: roll_dice ok:true");
    ok(Number.isSafeInteger(j.result) && j.result >= 1 && j.result <= 6, "live: roll_dice result is an integer 1..6");
    eq(j.program, "provably-fair-dice", "live: program echoed");
    eq(j.function, "roll_dice", "live: function echoed");
    ok(/^[0-9a-f]{64}$/.test(j.source_hash), "live: source_hash is 64 hex chars");
  }
  // integer-only contract: string params are refused, not coerced
  {
    const res = await fetch(UPSTREAM_BASE + "/v1/provably-fair-dice/roll_dice", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ server_seed: "abc", client_seed: 678, round: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    eq(j.ok, false, "live: string param refused (integer-only contract)");
    eq(res.status, 400, "live: string param -> HTTP 400");
  }
  // settle route: real shape
  {
    const res = await fetch(UPSTREAM_BASE + "/v1/casino-baccarat-settle/baccarat_settle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ stake_cents: 1000, bet_on: 0, winner: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    eq(j.ok, true, "live: baccarat_settle ok:true");
    ok(Number.isSafeInteger(j.result), "live: baccarat_settle result is an integer");
  }
  // end-to-end through the toll core: draw x2 -> idempotent; resolve matches
  {
    const d1 = await runExactoddsDraw({ game_id: "dice", draw_id: "selftest-wave2", count: 2 });
    eq(d1.results.length, 2, "live: draw count=2 returns 2 results");
    eq(d1.draw_id, "selftest-wave2", "live: draw_id echoed");
    eq(d1.results_sha256, sha256Hex(canonicalJson(d1.results)), "live: results_sha256 matches canonical recompute");
    const d2 = await runExactoddsDraw({ game_id: "dice", draw_id: "selftest-wave2", count: 2 });
    eq(d2.results_sha256, d1.results_sha256, "live: same (game_id, draw_id) replays identically (idempotent)");
    const r = await runExactoddsResolve({ game_id: "dice", draw_id: "selftest-wave2" });
    eq(r.settled, true, "live: resolve settled:true");
    eq(r.outcome, d1.results[0].result, "live: resolve outcome matches the draw's round-1 result");
    eq(r.outcome_sha256, sha256Hex(canonicalJson(r.outcome)), "live: outcome_sha256 matches canonical recompute");
  }
}

console.log(`toll-tools-wave2 selftest: ${n} assertions passed${liveSkipped ? `, ${liveSkipped} live assertions SKIPPED (upstream unreachable)` : ", live upstream verified"}`);
