/**
 * Resolve hook for TypeScript lib selftests under plain Node 24+
 * (native type-stripping). Maps the `@/lib/` path alias to this directory.
 * Loaded via ts-alias.hooks.mjs — do not import directly.
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const libDir = dirname(fileURLToPath(import.meta.url)) + "/";

export async function resolve(specifier, context, next) {
  if (specifier === "@supabase/supabase-js" && process.env.SELFTEST_DISK_ONLY === "1") {
    return { url: "file://" + libDir + "supabase-stub.mjs", shortCircuit: true };
  }
  if (specifier.startsWith("@/lib/")) {
    let p = specifier.replace("@/lib/", libDir);
    if (!/\.(ts|mjs|js|json)$/.test(p)) p += ".ts";
    return { url: "file://" + p, shortCircuit: true };
  }
  return next(specifier, context);
}
