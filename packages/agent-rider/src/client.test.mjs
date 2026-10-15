import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRiderClient, registerSeat, issueRider, RiderApiError } from "./index.mjs";

const KEY = "ar_test_fixture_only";
const TOKEN = "header.payload.signature";
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function fixture(handler) {
  const calls = [];
  let time = 1_800_000_000_000;
  const client = createRiderClient({
    apiKey: KEY, now: () => time,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (handler) return handler(url, options, calls);
      if (url.endsWith("/api/rider/issue")) return json({ rider: TOKEN, expires_in: 900 });
      return json({ message: { id: "msg-1" }, messages: [] }, options.method === "POST" ? 201 : 200);
    },
  });
  return { client, calls, advance: (ms) => { time += ms; } };
}

test("constructing a client does no I/O and exposes no credentials", () => {
  const { client, calls } = fixture();
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(client), "{}");
  assert.deepEqual(Object.keys(client), ["sendDirectMessage", "readThread", "close"]);
});

test("mint once, use scoped rider for DM and thread; never send permanent key to DM", async () => {
  const { client, calls } = fixture();
  await client.sendDirectMessage("peer-1", "Hello");
  await client.readThread("peer-1");
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].body), { level: "L1", scopes: ["dm:read", "dm:send"] });
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  for (const call of calls.slice(1)) {
    assert.equal(call.headers["X-Agent-Rider"], TOKEN);
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(JSON.stringify(call).includes(KEY), false);
  }
  assert.deepEqual(JSON.parse(calls[1].body), { to_agent_id: "peer-1", content: "Hello" });
  assert.equal(calls[2].url, "https://agentrider.fly.dev/api/dm/peer-1");
  assert.equal(calls[2].method, "GET");
  for (const call of calls) assert.equal(call.redirect, "error");
});

test("refreshes before TTL expiry, but not on every operation", async () => {
  const { client, calls, advance } = fixture();
  await client.readThread("peer");
  advance(869_999);
  await client.readThread("peer");
  assert.equal(calls.filter(c => c.url.endsWith("/issue")).length, 1);
  advance(1);
  await client.readThread("peer");
  assert.equal(calls.filter(c => c.url.endsWith("/issue")).length, 2);
});

test("concurrent operations share a single issuance", async () => {
  const { client, calls } = fixture();
  await Promise.all([client.readThread("one"), client.readThread("two"), client.readThread("three")]);
  assert.equal(calls.filter(c => c.url.endsWith("/issue")).length, 1);
  assert.equal(calls.length, 4);
});

test("failed issuance clears single-flight so a later explicit attempt can work", async () => {
  let attempts = 0;
  const { client, calls } = fixture((url) => {
    if (url.endsWith("/issue")) {
      attempts++;
      return attempts === 1 ? json({ error: "invalid_api_key" }, 401) : json({ rider: TOKEN, expires_in: 900 });
    }
    return json({ messages: [] });
  });
  await assert.rejects(client.readThread("peer"), { code: "invalid_api_key", status: 401 });
  assert.equal(calls.length, 1);
  await client.readThread("peer");
  assert.equal(attempts, 2);
});

test("401 invalidates credential but never automatically resends a DM", async () => {
  const { client, calls } = fixture((url) => url.endsWith("/issue")
    ? json({ rider: TOKEN, expires_in: 900 })
    : json({ error: "invalid_rider" }, 401));
  await assert.rejects(client.sendDirectMessage("peer", "Hello"), { code: "invalid_rider", status: 401 });
  assert.equal(calls.length, 2);
  await assert.rejects(client.sendDirectMessage("peer", "Explicit retry"), { code: "invalid_rider" });
  assert.equal(calls.length, 4);
});

test("429 exposes retry-after without retrying", async () => {
  const { client, calls } = fixture((url) => url.endsWith("/issue")
    ? json({ rider: TOKEN, expires_in: 900 })
    : json({ error: "rate_limit_exceeded" }, 429, { "Retry-After": "60" }));
  await assert.rejects(client.sendDirectMessage("peer", "Hello"), { status: 429, retryAfter: 60 });
  assert.equal(calls.length, 2);
});

test("500 response never automatically retries a possibly delivered message", async () => {
  const { client, calls } = fixture((url) => url.endsWith("/issue")
    ? json({ rider: TOKEN, expires_in: 900 })
    : json({ error: `remote echoed ${KEY} ${TOKEN}` }, 500));
  await assert.rejects(client.sendDirectMessage("peer", "Hello"), error => {
    assert.equal(error.code, "http_500");
    assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(KEY), false);
    assert.equal(error.body, undefined);
    return true;
  });
  assert.equal(calls.length, 2);
});

test("network failure is sanitized and is not retried", async () => {
  const { client, calls } = fixture(() => { throw new Error(`transport exposed ${KEY}`); });
  await assert.rejects(client.readThread("peer"), error => {
    assert.equal(error.code, "network_error");
    assert.equal(error.stack.includes(KEY), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("timeout aborts the request", async () => {
  let aborted = false;
  const client = createRiderClient({
    apiKey: KEY, timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }),
  });
  await assert.rejects(client.readThread("peer"), { code: "request_timeout" });
  assert.equal(aborted, true);
});

for (const base of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?key=x", "https://example.com#x", "file:///tmp"]) {
  test(`rejects unsafe destination ${base}`, () => {
    assert.throws(() => createRiderClient({ apiKey: KEY, base }), { code: "invalid_base_url" });
  });
}

test("allows explicit loopback development and normalizes trailing slash", async () => {
  let destination;
  await issueRider(KEY, {
    base: "http://127.0.0.1:3000/",
    fetchImpl: async url => { destination = url; return json({ rider: TOKEN, expires_in: 900 }); },
  });
  assert.equal(destination, "http://127.0.0.1:3000/api/rider/issue");
});

test("input errors never mint a credential", async () => {
  const { client, calls } = fixture();
  for (const id of ["", "..", "a/b", "a?b", "a#b", "a b"]) {
    await assert.rejects(client.readThread(id), { code: "invalid_agent_id" });
  }
  await assert.rejects(client.sendDirectMessage("peer", " "), { code: "content_required" });
  await assert.rejects(client.sendDirectMessage("peer", "x".repeat(4001)), { code: "content_too_long" });
  assert.equal(calls.length, 0);
});

test("read-only scopes cannot send messages", async () => {
  let calls = 0;
  const client = createRiderClient({
    apiKey: KEY, scopes: ["dm:read"],
    fetchImpl: async () => { calls++; return json({}); },
  });
  await assert.rejects(client.sendDirectMessage("peer", "Hello"), { code: "insufficient_scope" });
  assert.equal(calls, 0);
});

test("close prevents more operations", async () => {
  const { client, calls } = fixture();
  await client.readThread("peer");
  client.close();
  await assert.rejects(client.readThread("peer"), { code: "client_closed" });
  assert.equal(calls.length, 2);
});

test("close during issuance prevents follow-on DM", async () => {
  let resolve;
  const { client, calls } = fixture(() => new Promise(r => { resolve = r; }));
  const pending = client.sendDirectMessage("peer", "Hello");
  client.close();
  resolve(json({ rider: TOKEN, expires_in: 900 }));
  await assert.rejects(pending, { code: "client_closed" });
  assert.equal(calls.length, 1);
});

test("malformed JSON is a typed error, not a successful empty object", async () => {
  const { client } = fixture(() => new Response("<html>upstream down</html>", { status: 502 }));
  await assert.rejects(client.readThread("peer"), { code: "invalid_json_response", status: 502 });
});

test("malformed issuance cannot reach a gated route", async () => {
  for (const body of [{}, { rider: TOKEN }, { rider: TOKEN, expires_in: 0 }, { rider: TOKEN, expires_in: 901 }, { rider: "bad", expires_in: 900 }, { rider: "..", expires_in: 900 }]) {
    const { client, calls } = fixture(() => json(body));
    await assert.rejects(client.readThread("peer"), { code: "invalid_issue_response" });
    assert.equal(calls.length, 1);
  }
});

test("registration forwards promo, referral and capability fields", async () => {
  let sent;
  const result = await registerSeat({
    name: "test-seat", promo_code: "TEST-PROMO", referral_code: "TEST-REF",
    capabilities: ["fetch"],
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return json({ agent_id: "test", api_key: KEY }, 201); },
  });
  assert.equal(sent.promo_code, "TEST-PROMO");
  assert.equal(sent.referral_code, "TEST-REF");
  assert.deepEqual(sent.capabilities, ["fetch"]);
  assert.equal(result.api_key, KEY);
});

test("typed transport errors are exported", async () => {
  await assert.rejects(issueRider(KEY, {
    fetchImpl: async () => json({ error: "invalid_api_key" }, 401),
  }), error => error instanceof RiderApiError && error.status === 401);
});

async function localServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("native HTTP transport performs issue -> send -> read with correct auth separation", async t => {
  const seen = [];
  const base = await localServer(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ path: req.url, method: req.method, headers: req.headers, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/rider/issue") res.end(JSON.stringify({ rider: TOKEN, expires_in: 900 }));
    else if (req.method === "POST") { res.statusCode = 201; res.end(JSON.stringify({ message: { id: "local-message" } })); }
    else res.end(JSON.stringify({ messages: [{ id: "local-message" }] }));
  });
  const client = createRiderClient({ apiKey: KEY, base });
  const sent = await client.sendDirectMessage("local-peer", "Local fixture only");
  const thread = await client.readThread("local-peer");
  assert.equal(sent.message.id, "local-message");
  assert.equal(thread.messages[0].id, "local-message");
  assert.equal(seen.length, 3);
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  for (const call of seen.slice(1)) {
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers["x-agent-rider"], TOKEN);
  }
  client.close();
});

test("native HTTP transport never follows issuance or messaging redirects", async t => {
  let leaked = 0;
  const destination = await localServer(t, (_req, res) => { leaked++; res.end("{}"); });
  for (const redirectIssue of [true, false]) {
    let calls = 0;
    const base = await localServer(t, (req, res) => {
      calls++;
      if (!redirectIssue && req.url === "/api/rider/issue") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ rider: TOKEN, expires_in: 900 }));
      } else {
        res.writeHead(307, { Location: `${destination}/must-not-receive-credentials` });
        res.end();
      }
    });
    const client = createRiderClient({ apiKey: KEY, base });
    await assert.rejects(client.sendDirectMessage("local-peer", "Local fixture"), { code: "network_error" });
    assert.equal(calls, redirectIssue ? 1 : 2);
    client.close();
  }
  assert.equal(leaked, 0);
});

test("issuance transport latency cannot extend the token lifetime", async () => {
  let now = 1_800_000_000_000;
  let calls = 0;
  const client = createRiderClient({
    apiKey: KEY, now: () => now,
    fetchImpl: async () => { calls++; now += 901_000; return json({ rider: TOKEN, expires_in: 900 }); },
  });
  await assert.rejects(client.readThread("peer"), { code: "expired_issue_response" });
  assert.equal(calls, 1);
});
