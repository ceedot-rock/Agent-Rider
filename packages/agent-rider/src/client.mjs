import { normalizeBase, requestJson, RiderApiError } from "./transport.mjs";

const DEFAULT_SCOPES = ["dm:read", "dm:send"];

/**
 * Create an in-memory, single-seat messaging client. Construction does no I/O.
 * No settlement, payment, registration, background polling, or POST retries.
 *
 * @param {{ apiKey: string, base?: string, scopes?: string[],
 * fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} options
 */
export function createRiderClient({
  apiKey, base = "https://agentrider.fly.dev", scopes = DEFAULT_SCOPES,
  fetchImpl = globalThis.fetch, timeoutMs = 10_000, now = Date.now,
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.startsWith("ar_") ||
      apiKey.length <= 3 || /\s/.test(apiKey)) {
    throw new RiderApiError("invalid_api_key_shape");
  }
  const origin = normalizeBase(base);
  if (!Array.isArray(scopes) || scopes.length === 0 ||
      scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
    throw new RiderApiError("invalid_scopes");
  }
  const grantedScopes = [...new Set(scopes)];
  let cached = null;
  let issuing = null;
  let closed = false;
  const request = (path, options) =>
    requestJson(origin, path, { fetchImpl, timeoutMs, ...options });

  function assertOpen() {
    if (closed) throw new RiderApiError("client_closed");
  }

  async function credential() {
    assertOpen();
    if (cached && now() < cached.refreshAt) return cached.token;
    if (!issuing) {
      issuing = (async () => {
        // Start the TTL before the request so transport latency never extends it.
        const started = now();
        const issued = await request("/api/rider/issue", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: { level: "L1", scopes: grantedScopes },
        });
        assertOpen();
        if (typeof issued.rider !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(issued.rider) ||
            !Number.isSafeInteger(issued.expires_in) || issued.expires_in <= 0 ||
            issued.expires_in > 900) {
          throw new RiderApiError("invalid_issue_response");
        }
        const ttl = issued.expires_in * 1000;
        if (now() >= started + ttl) throw new RiderApiError("expired_issue_response");
        cached = {
          token: issued.rider,
          refreshAt: started + ttl - Math.min(30_000, ttl / 10),
        };
        return cached.token;
      })().finally(() => { issuing = null; });
    }
    return issuing;
  }

  async function gated(path, options = {}) {
    const token = await credential();
    assertOpen();
    try {
      return await request(path, {
        ...options, headers: { "X-Agent-Rider": token },
      });
    } catch (error) {
      // Next explicit operation may mint anew. Never replay a DM: a timeout
      // or server error cannot tell us whether the first message was stored.
      if (error.status === 401 && cached?.token === token) cached = null;
      throw error;
    }
  }

  function peerId(value) {
    // Agent IDs are path segments. Reject dot-segment tricks and separators.
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      throw new RiderApiError("invalid_agent_id");
    }
    return value;
  }

  return Object.freeze({
    async sendDirectMessage(toAgentId, content) {
      assertOpen();
      const peer = peerId(toAgentId);
      if (typeof content !== "string" || !content.trim()) throw new RiderApiError("content_required");
      if (content.length > 4000) throw new RiderApiError("content_too_long");
      if (!grantedScopes.includes("*") && !grantedScopes.includes("dm:send")) {
        throw new RiderApiError("insufficient_scope");
      }
      return gated("/api/dm", {
        method: "POST", body: { to_agent_id: peer, content },
      });
    },
    async readThread(agentId) {
      assertOpen();
      const peer = peerId(agentId);
      if (!grantedScopes.includes("*") && !grantedScopes.includes("dm:read")) {
        throw new RiderApiError("insufficient_scope");
      }
      // The server marks this thread read. This is not a read-only inbox peek.
      return gated(`/api/dm/${encodeURIComponent(peer)}`);
    },
    close() {
      closed = true;
      cached = null;
      apiKey = null;
    },
  });
}
