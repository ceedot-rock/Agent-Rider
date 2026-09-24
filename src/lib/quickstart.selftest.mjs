/**
 * Quickstart dry-path selftest — source shape + optional live run.
 *
 *   node src/lib/quickstart.selftest.mjs
 *   cd src && npm run selftest:quickstart
 *
 * Live (default): runs packages/agent-rider-quickstart/quickstart.mjs against agentrider.fly.dev
 * (ephemeral register fallback). SKIP_LIVE=1 for source-only.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const pkgDir = join(root, "packages/agent-rider-quickstart");
const qs = join(pkgDir, "quickstart.mjs");
const pkg = join(pkgDir, "package.json");

assert.ok(existsSync(qs), "packages/agent-rider-quickstart/quickstart.mjs missing");
assert.ok(existsSync(pkg), "package.json missing");
assert.ok(existsSync(join(root, "examples/quickstart.mjs")), "examples/quickstart.mjs missing");
assert.ok(existsSync(join(root, "docs/QUICKSTART.md")), "docs/QUICKSTART.md missing");

const src = readFileSync(qs, "utf8");
assert.match(src, /agentrider\.fly\.dev/);
assert.match(src, /slidphilabs\.com\/pcc/);
assert.match(src, /createRemoteJWKSet|jwtVerify/);
assert.match(src, /\/api\/rider\/verify/);
assert.match(src, /ar_sandbox_demo/);
assert.match(src, /SETTLE_FUNDED|flip_to_paid/);
assert.doesNotMatch(src, /RIDER_PRIVATE_KEY\s*=/);
assert.doesNotMatch(src, /SETTLE_PAYER_PRIVATE_KEY\s*=\s*0x/);

const pj = JSON.parse(readFileSync(pkg, "utf8"));
assert.equal(pj.name, "agent-rider-quickstart");
assert.ok(pj.dependencies?.jose);

const docs = readFileSync(join(root, "docs/QUICKSTART.md"), "utf8");
assert.match(docs, /slidphilabs\.com\/pcc/);
assert.match(docs, /RIDER_SANDBOX_API_KEY/);
assert.match(docs, /RIDER_SANDBOX_KEY/);
assert.match(docs, /not a cash door|not the cash door|not a second cash door/i);
assert.match(docs, /SETTLE_FUNDED/);
assert.doesNotMatch(docs, /\bar_[a-f0-9]{16,}/);

console.log("PASS  quickstart source + docs");

if (process.env.SKIP_LIVE === "1") {
  console.log("SKIP  live quickstart (SKIP_LIVE=1)");
  console.log("quickstart.selftest: ok");
  process.exit(0);
}

// Ensure jose is installed in the package
const install = spawnSync("npm", ["install", "--no-fund", "--no-audit"], {
  cwd: pkgDir,
  encoding: "utf8",
  timeout: 120_000,
});
if (install.status !== 0) {
  console.error(install.stderr || install.stdout);
  throw new Error("npm install failed in agent-rider-quickstart");
}

const run = spawnSync("node", ["quickstart.mjs"], {
  cwd: pkgDir,
  encoding: "utf8",
  timeout: 60_000,
  env: { ...process.env },
});
const out = `${run.stdout || ""}\n${run.stderr || ""}`;
if (run.status !== 0) {
  console.error(out);
  throw new Error(`quickstart.mjs exited ${run.status}`);
}
assert.match(out, /"ok":\s*true/);
assert.match(out, /jwks_es256/);
assert.doesNotMatch(out, /RIDER_PRIVATE_KEY/);
assert.doesNotMatch(out, /-----BEGIN PRIVATE KEY-----/);
console.log("PASS  live quickstart dry path (ok:true)");
console.log("quickstart.selftest: ok");
