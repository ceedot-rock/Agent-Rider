/**
 * Rider → Studio POST /api/pass gate selftest. No secrets. Mock fetch only.
 * Run: cd src && npm run selftest:cuni-studio-pass
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isStudioPassRequired,
  resolveStudioUrl,
  extractStudioPassSource,
  shouldCallStudioPass,
  callStudioPass,
  checkStudioPassGate,
  isStudioPassGateOk,
  DEFAULT_CUNI_STUDIO_URL,
  CUNI_STUDIO_PASS_REQUIRED_ENV,
} from "./cuni-studio-pass.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- flag / url ---
assert.equal(isStudioPassRequired({}), false);
assert.equal(isStudioPassRequired({ CUNI_STUDIO_PASS_REQUIRED: "false" }), false);
assert.equal(isStudioPassRequired({ CUNI_STUDIO_PASS_REQUIRED: "true" }), true);
assert.equal(isStudioPassRequired({ CUNI_STUDIO_PASS_REQUIRED: "1" }), true);
assert.equal(resolveStudioUrl({}), DEFAULT_CUNI_STUDIO_URL);
assert.equal(
  resolveStudioUrl({ CUNI_STUDIO_URL: "https://example.test/" }),
  "https://example.test"
);

// --- extract ---
assert.equal(extractStudioPassSource({}), null);
assert.equal(extractStudioPassSource({ source: "say(1)" }), "say(1)");
assert.equal(extractStudioPassSource({ cuni_source: "x" }), "x");
assert.equal(extractStudioPassSource({ meta: { source: "m" } }), "m");

assert.equal(shouldCallStudioPass({}, {}), false);
assert.equal(
  shouldCallStudioPass({}, { CUNI_STUDIO_PASS_REQUIRED: "true" }),
  true
);
assert.equal(shouldCallStudioPass({ studio_pass: true }, {}), true);

// --- skip when off ---
{
  const r = await checkStudioPassGate({ taskId: "t1" }, {});
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(r.studio, "not_called");
  assert.equal(isStudioPassGateOk(r), true);
}

// --- missing source refuse (required, no network) ---
{
  let called = 0;
  const r = await checkStudioPassGate(
    { taskId: "t1" },
    { CUNI_STUDIO_PASS_REQUIRED: "true" },
    {
      fetchImpl: async () => {
        called++;
        throw new Error("should_not_fetch");
      },
    }
  );
  assert.equal(called, 0);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.body.verdict, "REFUSE");
  assert.match(String(r.body.error), /missing source/i);
  assert.equal(r.body.studio, "not_called");
}

// --- mock REFUSE ---
{
  const r = await checkStudioPassGate(
    { source: "say(1+", studio_pass: true },
    {},
    {
      fetchImpl: async (_url, init) => {
        assert.match(String(_url), /\/api\/pass$/);
        const posted = JSON.parse(init.body);
        assert.equal(posted.source, "say(1+");
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              ok: false,
              verdict: "REFUSE",
              citizen_receipt: null,
              error: "exactness failed",
              studio: "called",
            }),
        };
      },
    }
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.body.verdict, "REFUSE");
  assert.equal(r.body.studio, "called");
  assert.match(String(r.body.error), /exactness failed|REFUSE/i);
}

// --- mock PASS ---
{
  const receipt = {
    source_hash: "9191a5644bc62189deadbeef",
    exactness: { passed: true },
  };
  const r = await checkStudioPassGate(
    { source: "ok", studio_pass: true },
    {},
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            verdict: "PASS",
            citizen_receipt: receipt,
            studio: "called",
          }),
      }),
    }
  );
  assert.equal(r.ok, true);
  assert.equal(r.skipped, false);
  assert.equal(r.studio, "called");
  assert.equal(r.citizen_receipt.source_hash, receipt.source_hash);
}

// --- unreachable fail-closed ---
{
  const r = await checkStudioPassGate(
    { source: "x" },
    { CUNI_STUDIO_PASS_REQUIRED: "true" },
    {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED mock");
      },
    }
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "studio_pass_unreachable");
}

// --- callStudioPass missing source local ---
{
  const r = await callStudioPass({ source: "" });
  assert.equal(r.ok, false);
  assert.equal(r.studio, "not_called");
  assert.match(String(r.error), /missing source/i);
}

// --- honesty: no secrets in module ---
const src = readFileSync(join(__dirname, "cuni-studio-pass.mjs"), "utf8");
assert.match(src, /CUNI_STUDIO_PASS_REQUIRED/);
assert.match(src, /\/api\/pass/);
assert.match(src, /studio_pass_unreachable/);
assert.match(src, /never PCC|PCC = lossless|compressor/i);
assert.doesNotMatch(src, /\bar_[A-Za-z0-9]{8,}/);
assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);

const ts = readFileSync(join(__dirname, "cuni-studio-pass.ts"), "utf8");
assert.match(ts, /cuni-studio-pass\.mjs/);
assert.match(ts, /env-gated/i);

// --- routes hooked (claim + first-job); contracts must NOT re-call Studio pass ---
for (const rel of ["../app/api/tasks/claim/route.ts", "../app/api/first-job/route.ts"]) {
  const r = readFileSync(join(__dirname, rel), "utf8");
  assert.match(r, /checkStudioPassGate|isStudioPassGateOk/);
  assert.match(r, /checkCitizenReceiptGate/);
}
const contracts = readFileSync(
  join(__dirname, "../app/api/v0/contracts/route.ts"),
  "utf8"
);
assert.doesNotMatch(contracts, /checkStudioPassGate/);

// --- docs honesty: outbound WIRED env-gated (not soft always-live) ---
const doc = readFileSync(join(__dirname, "../../docs/CUNI_CITIZEN_GATE.md"), "utf8");
assert.match(doc, /WIRED|env-gated|CUNI_STUDIO_PASS_REQUIRED/i);
assert.match(doc, /\/api\/pass/);
assert.match(doc, /never PCC|not PCC/i);
assert.doesNotMatch(doc, /outbound still \*\*PARKED\*\*/i);
assert.doesNotMatch(doc, /Studio pass is always live|always calls Studio/i);
assert.doesNotMatch(doc, /\bar_[A-Za-z0-9]{8,}/);

const coord = readFileSync(join(__dirname, "../../docs/_CUNI_COORD_PASS_GATE.md"), "utf8");
assert.match(coord, /WIRED|env-gated|CUNI_STUDIO_PASS_REQUIRED/i);
assert.doesNotMatch(coord, /outbound verify.*\*\*PARKED\*\*/i);

const integ = readFileSync(join(__dirname, "../../docs/CUNI_INTEGRATION.md"), "utf8");
assert.match(integ, /WIRED|env-gated|CUNI_STUDIO_PASS_REQUIRED/i);
assert.doesNotMatch(integ, /outbound verify: still \*\*PARKED\*\*/i);

console.log(
  "cuni-studio-pass.selftest: ok (skip / missing / REFUSE / PASS / unreachable / honesty)"
);
