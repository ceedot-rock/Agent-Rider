/**
 * Rider → CuNi Studio Execute verify — POST /api/pass (env-gated).
 *
 * When CUNI_STUDIO_PASS_REQUIRED=true (or body.studio_pass===true), Execute
 * paths call Studio BEFORE sealed ride / job accept proceeds.
 *
 * Default OFF (pass-through) for safe merge. Fail-closed on network errors
 * when required. Never softens Studio REFUSE. Never logs ar_/JWT secrets.
 *
 * PCC = lossless compressor only — never fund/paywall.
 * Receive path (POST /api/v0/citizen-receipts) is unchanged — do not re-call
 * Studio on contracts Translate ingress.
 *
 * Docs: docs/CUNI_CITIZEN_GATE.md · CuNi PASS_GATE.md
 */

export const CUNI_STUDIO_PASS_REQUIRED_ENV = "CUNI_STUDIO_PASS_REQUIRED";
export const CUNI_STUDIO_URL_ENV = "CUNI_STUDIO_URL";
export const DEFAULT_CUNI_STUDIO_URL = "https://cuni-studio.fly.dev";
export const CUNI_STUDIO_PASS_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/CUNI_CITIZEN_GATE.md";
export const CUNI_STUDIO_PASS_TIMEOUT_MS = 15_000;

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isStudioPassRequired(env = process.env) {
  const raw = env[CUNI_STUDIO_PASS_REQUIRED_ENV];
  if (raw == null || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveStudioUrl(env = process.env) {
  const raw = env[CUNI_STUDIO_URL_ENV];
  if (raw == null || String(raw).trim() === "") return DEFAULT_CUNI_STUDIO_URL;
  return String(raw).trim().replace(/\/+$/, "");
}

/**
 * Extract .cuni source from an Execute body.
 * @param {unknown} body
 * @returns {string | null}
 */
export function extractStudioPassSource(body) {
  if (!body || typeof body !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (body);
  for (const key of ["source", "cuni_source", "cuniSource"]) {
    if (typeof obj[key] === "string" && obj[key].trim().length > 0) {
      return obj[key].trim();
    }
  }
  const meta =
    obj.meta && typeof obj.meta === "object"
      ? /** @type {Record<string, unknown>} */ (obj.meta)
      : null;
  if (meta && typeof meta.source === "string" && meta.source.trim().length > 0) {
    return meta.source.trim();
  }
  return null;
}

/**
 * Whether this request should round-trip Studio /api/pass.
 * Env fail-closed OR explicit body.studio_pass===true.
 * @param {unknown} body
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function shouldCallStudioPass(body, env = process.env) {
  if (isStudioPassRequired(env)) return true;
  if (body && typeof body === "object") {
    const obj = /** @type {Record<string, unknown>} */ (body);
    if (obj.studio_pass === true || obj.studioPass === true) return true;
  }
  return false;
}

/**
 * Redact anything that looks like ar_ / JWT from error strings (never print keys).
 * @param {unknown} value
 * @returns {string}
 */
function safeErrorString(value) {
  let s = value == null ? "" : String(value);
  s = s.replace(/\bar_[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]");
  s = s.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    "[REDACTED]"
  );
  if (s.length > 800) s = s.slice(0, 800) + "…";
  return s;
}

/**
 * POST {source} to Studio /api/pass. Always callable (tests / opt-in).
 * Never throws secrets; network failures return ok:false.
 *
 * @param {{ source: string, studioUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   verdict: string | null,
 *   citizen_receipt: unknown | null,
 *   studio: "called" | "not_called",
 *   error: string | null,
 *   body: unknown,
 *   exactness?: unknown,
 *   source_hash?: string | null,
 * }>}
 */
export async function callStudioPass(opts) {
  const source = opts?.source;
  if (typeof source !== "string" || source.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      verdict: "REFUSE",
      citizen_receipt: null,
      studio: "not_called",
      error: "missing source",
      body: {
        ok: false,
        verdict: "REFUSE",
        citizen_receipt: null,
        error: "missing source",
        studio: "not_called",
      },
      exactness: { passed: false },
      source_hash: null,
    };
  }

  const base = (opts.studioUrl || DEFAULT_CUNI_STUDIO_URL).replace(/\/+$/, "");
  const url = `${base}/api/pass`;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? CUNI_STUDIO_PASS_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      status: 503,
      verdict: "REFUSE",
      citizen_receipt: null,
      studio: "not_called",
      error: "studio_pass_unreachable",
      body: {
        ok: false,
        error: "studio_pass_unreachable",
        message: "fetch unavailable",
        studio: "not_called",
        docs_url: CUNI_STUDIO_PASS_DOCS,
      },
      exactness: { passed: false },
      source_hash: null,
    };
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ source: source.trim() }),
      signal: controller ? controller.signal : undefined,
    });
    let parsed = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { ok: false, error: "studio_pass_non_json", raw_len: text.length };
    }
    const obj =
      parsed && typeof parsed === "object"
        ? /** @type {Record<string, unknown>} */ (parsed)
        : {};
    const verdict =
      typeof obj.verdict === "string"
        ? obj.verdict
        : res.ok
          ? "PASS"
          : "REFUSE";
    const citizen_receipt =
      obj.citizen_receipt != null
        ? obj.citizen_receipt
        : obj.citizenReceipt != null
          ? obj.citizenReceipt
          : null;
    const err =
      typeof obj.error === "string"
        ? safeErrorString(obj.error)
        : res.ok
          ? null
          : safeErrorString(obj.message || `studio_http_${res.status}`);
    const source_hash =
      citizen_receipt &&
      typeof citizen_receipt === "object" &&
      typeof /** @type {Record<string, unknown>} */ (citizen_receipt).source_hash ===
        "string"
        ? /** @type {Record<string, unknown>} */ (citizen_receipt).source_hash
        : typeof obj.source_hash === "string"
          ? obj.source_hash
          : null;

    return {
      ok: res.ok === true && (obj.ok === true || verdict === "PASS"),
      status: res.status,
      verdict,
      citizen_receipt,
      studio: "called",
      error: err,
      body: {
        ...obj,
        studio: "called",
        ...(err && !obj.error ? { error: err } : {}),
      },
      exactness: obj.exactness,
      source_hash,
    };
  } catch (e) {
    const msg = safeErrorString(
      e && typeof e === "object" && "name" in e && e.name === "AbortError"
        ? "studio_pass_timeout"
        : e instanceof Error
          ? e.message
          : "studio_pass_unreachable"
    );
    return {
      ok: false,
      status: 503,
      verdict: "REFUSE",
      citizen_receipt: null,
      studio: "not_called",
      error: "studio_pass_unreachable",
      body: {
        ok: false,
        error: "studio_pass_unreachable",
        message: msg,
        studio: "not_called",
        docs_url: CUNI_STUDIO_PASS_DOCS,
        gate: {
          name: CUNI_STUDIO_PASS_REQUIRED_ENV,
          note: "Fail-closed — Studio /api/pass unreachable when required.",
        },
      },
      exactness: { passed: false },
      source_hash: null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Alias — always callable verify. */
export async function verifyWithStudioPass(source, opts = {}) {
  return callStudioPass({ ...opts, source });
}

/**
 * Execute gate: skip when off; refuse missing source locally; else POST Studio.
 *
 * @param {unknown} body
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<
 *   | { ok: true, skipped: true, studio: "not_called", required: false, citizen_receipt: null }
 *   | { ok: true, skipped: false, studio: "called", required: boolean, citizen_receipt: unknown, result: object }
 *   | { ok: false, status: number, body: object }
 * >}
 */
export async function checkStudioPassGate(body, env = process.env, opts = {}) {
  const required = isStudioPassRequired(env);
  const asked = shouldCallStudioPass(body, env);

  if (!asked) {
    return {
      ok: true,
      skipped: true,
      studio: "not_called",
      required: false,
      citizen_receipt: null,
    };
  }

  const source = extractStudioPassSource(body);
  if (!source) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        verdict: "REFUSE",
        error: "missing source",
        message:
          "CUNI_STUDIO_PASS_REQUIRED / studio_pass: provide source (or cuni_source / meta.source) for Studio POST /api/pass",
        citizen_receipt: null,
        studio: "not_called",
        docs_url: CUNI_STUDIO_PASS_DOCS,
        gate: {
          name: CUNI_STUDIO_PASS_REQUIRED_ENV,
          required,
          note: "Local refuse — missing source; Studio not called.",
        },
      },
    };
  }

  const result = await callStudioPass({
    source,
    studioUrl: resolveStudioUrl(env),
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });

  if (result.error === "studio_pass_unreachable" || result.status === 503) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        error: "studio_pass_unreachable",
        message: safeErrorString(result.body?.message || result.error),
        verdict: "REFUSE",
        citizen_receipt: null,
        studio: result.studio,
        docs_url: CUNI_STUDIO_PASS_DOCS,
        gate: {
          name: CUNI_STUDIO_PASS_REQUIRED_ENV,
          required,
          note: "Fail-closed — Studio /api/pass unreachable.",
        },
      },
    };
  }

  if (!result.ok || result.verdict === "REFUSE") {
    const studioBody =
      result.body && typeof result.body === "object"
        ? /** @type {Record<string, unknown>} */ (result.body)
        : {};
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        verdict: "REFUSE",
        error: safeErrorString(result.error || studioBody.error || "studio_refuse"),
        diagnostics: studioBody.diagnostics,
        exactness: studioBody.exactness ?? { passed: false },
        citizen_receipt: null,
        studio: "called",
        docs_url: CUNI_STUDIO_PASS_DOCS,
        gate: {
          name: CUNI_STUDIO_PASS_REQUIRED_ENV,
          required,
          note: "Studio REFUSE forwarded — not softened.",
        },
      },
    };
  }

  return {
    ok: true,
    skipped: false,
    studio: "called",
    required,
    citizen_receipt: result.citizen_receipt,
    result,
  };
}

/**
 * @param {Awaited<ReturnType<typeof checkStudioPassGate>>} result
 */
export function isStudioPassGateOk(result) {
  return result != null && result.ok === true;
}
