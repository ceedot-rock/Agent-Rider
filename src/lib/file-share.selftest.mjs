/**
 * File-share scaffold honesty — no network, no secrets.
 * Asserts planned body shape and that routes stay 501 stubs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "file-share.ts"), "utf8");

assert.match(src, /error:\s*"file_share_planned"/);
assert.match(src, /status:\s*"not_live"/);
assert.match(src, /Coming next: file sharing — same signed seats \(not live\)/);
assert.match(src, /FILE_SHARE_LIVE/);
assert.match(src, /live:\s*false/);
assert.match(src, /Do not implement real transfer/i);

for (const rel of [
  "../app/api/files/route.ts",
  "../app/api/files/share/route.ts",
  "../app/api/files/[id]/route.ts",
]) {
  const r = readFileSync(join(__dirname, rel), "utf8");
  assert.match(r, /FILE_SHARE_HTTP_STATUS|501/);
  assert.match(r, /fileSharePlannedBody/);
  assert.doesNotMatch(r, /\b(S3Client|putObject|createWriteStream)\b/);
}

console.log("file-share.selftest: ok (planned not live)");
