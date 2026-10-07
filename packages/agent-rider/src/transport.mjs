/** Transport shared by the thin helpers and stateful messaging client. */
export class RiderApiError extends Error {
  constructor(code, { status = null, retryAfter = null } = {}) {
    super(code);
    this.name = "RiderApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const PUBLIC_ERRORS = new Set([
  "missing_name", "register_failed", "missing_auth", "invalid_api_key",
  "missing_rider", "invalid_rider", "insufficient_clearance", "insufficient_scope",
  "rate_limit_exceeded", "recipient_not_found", "content_required",
  "content_too_long", "missing_fields", "sandbox_not_configured",
]);

export function normalizeBase(base) {
  let url;
  try { url = new URL(base); } catch { throw new RiderApiError("invalid_base_url"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/"
  ) throw new RiderApiError("invalid_base_url");
  return url.origin;
}

export async function requestJson(base, path, {
  method = "GET", headers = {}, body, fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RiderApiError("invalid_timeout");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${normalizeBase(base)}${path}`, {
      method,
      headers: { Accept: "application/json", ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Never forward a permanent key or rider to a redirected destination.
      redirect: "error",
    });
    let data;
    try { data = await res.json(); } catch {
      if (controller.signal.aborted) throw new RiderApiError("request_timeout");
      throw new RiderApiError("invalid_json_response", { status: res.status });
    }
    if (!res.ok) {
      const code = PUBLIC_ERRORS.has(data?.error) ? data.error : `http_${res.status}`;
      const retry = res.headers?.get("retry-after");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
      // No raw body, headers, request URL, key, token, or remote error echo.
      throw new RiderApiError(code, {
        status: res.status,
        retryAfter: Number.isSafeInteger(seconds) ? seconds : null,
      });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new RiderApiError("invalid_json_response", { status: res.status });
    }
    return data;
  } catch (error) {
    if (error instanceof RiderApiError) throw error;
    throw new RiderApiError(controller.signal.aborted ? "request_timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}
