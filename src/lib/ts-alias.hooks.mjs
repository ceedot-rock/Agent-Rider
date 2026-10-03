/**
 * Loader hooks for running TypeScript lib selftests under plain Node 24+
 * (native type-stripping). Resolves the `@/lib/` path alias used across
 * src/lib. Run: node --import ./ts-alias.hooks.mjs <test>.selftest.mjs
 *
 * NOTE: @supabase/supabase-js is NOT installed in this selftest harness.
 * Tests must run disk-only (no SUPABASE_* env vars) so getDB() throws and
 * the lib falls back to the disk store. That is the path under test.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "ts-alias.resolve.mjs")));
