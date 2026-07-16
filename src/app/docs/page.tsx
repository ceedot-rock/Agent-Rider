import type { ReactNode } from "react";
import { RiderMark } from "@/components/RiderMark";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "var(--bg)",
        border: "1px solid var(--panel-line)",
        borderRadius: 8,
        padding: "16px 18px",
        overflowX: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--white)",
        margin: "0 0 28px",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{children}</code>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ padding: "0 0 56px" }}>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DocsPage() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px 80px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "28px 0",
        }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <RiderMark size={36} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: "-0.01em",
            }}
          >
            Agent<span style={{ color: "var(--gold)" }}>^</span>Rider
          </span>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <a href="/" style={{ fontSize: 14, color: "var(--muted)" }}>
            Home
          </a>
          <a href="/demo" style={{ fontSize: 14, color: "var(--muted)" }}>
            Demo
          </a>
          <a href="/#pricing" style={{ fontSize: 14, color: "var(--gold)" }}>
            Get Merchant Gate
          </a>
        </nav>
      </header>

      <div style={{ padding: "16px 0 48px" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(30px, 4vw, 42px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 14px",
          }}
        >
          Integrating the gate
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", maxWidth: 620 }}>
          There are two credentials in play: your <strong>merchant key</strong>{" "}
          (proves your subscription is active, used to mint riders) and a{" "}
          <strong>rider</strong> (a signed JWT you hand to an agent, and that
          any gate can verify locally — no call back to us required).
        </p>
      </div>

      <Section title="1. Subscribe and get a merchant key">
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          Start a Merchant Gate subscription from{" "}
          <a href="/#pricing" style={{ color: "var(--gold)" }}>
            the pricing section
          </a>
          . After checkout, the success page calls{" "}
          <InlineCode>GET /api/provision?session_id=...</InlineCode> and shows
          your merchant key once (format: <InlineCode>merchant_live_...</InlineCode>). Store
          it somewhere safe — it isn't shown again, and it's what authorizes
          rider issuance below.
        </p>
      </Section>

      <Section title="2. Issue a rider for an agent">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Mint a signed rider for an agent you've cleared — issuance itself
          is free. Requires your merchant key in the{" "}
          <InlineCode>X-Merchant-Key</InlineCode> header, gated on your
          subscription being active; local rider verification (next section)
          needs no key at all.
        </p>
        <CodeBlock>{`POST /api/rider/issue
X-Merchant-Key: merchant_live_...
Content-Type: application/json

{
  "agent_id": "a7f2-rider-9c14",
  "operator_id": "network.acme-fleet",
  "level": "L2",
  "scopes": ["read:catalog", "purchase:<100"]
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>Response:</p>
        <CodeBlock>{`{
  "rider": "eyJhbGciOiJFUzI1NiIs...",
  "jti": "3f9c...",
  "expires_in": 900,
  "header_to_send": "X-Agent-Rider"
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          Riders expire in 15 minutes by default. Hand the{" "}
          <InlineCode>rider</InlineCode> token to the agent; it presents it as{" "}
          <InlineCode>X-Agent-Rider</InlineCode> at every gate it crosses.
        </p>
      </Section>

      <Section title="3. Verify a rider at your gate">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Two ways to do this. Only the first one is actually free of a round
          trip to us — use it if you're gating real traffic.
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, fontWeight: 600 }}>
          Option A — local verification (recommended)
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Fetch our public key once from a standard JWKS endpoint, cache it,
          and verify the ES256 signature yourself. No call to us per request:
        </p>
        <CodeBlock>{`import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://agentrider.vercel.app/.well-known/jwks.json")
);

const { payload: rider } = await jwtVerify(riderToken, JWKS, {
  issuer: "agentrider.dev",
});
// rider.agent_id, rider.operator_id, rider.level, rider.scopes, rider.jti`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          <InlineCode>jwtVerify</InlineCode> throws on an expired, tampered,
          or malformed token — <InlineCode>createRemoteJWKSet</InlineCode>{" "}
          handles fetching and caching the key set for you, in any JWT
          library that supports JWKS, not just <InlineCode>jose</InlineCode>.
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, fontWeight: 600 }}>
          Option B — our verify endpoint
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Same signature check, run on our server instead of yours — simpler
          to call, but it's one HTTP request to us per check, not local:
        </p>
        <CodeBlock>{`POST /api/rider/verify
Content-Type: application/json

{
  "rider": "eyJhbGciOiJFUzI1NiIs..."
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>Response:</p>
        <CodeBlock>{`{
  "valid": true,
  "rider": {
    "agent_id": "a7f2-rider-9c14",
    "operator_id": "network.acme-fleet",
    "level": "L2",
    "scopes": ["read:catalog", "purchase:<100"],
    "jti": "3f9c..."
  }
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          An expired, tampered, or malformed rider returns{" "}
          <InlineCode>{`{"valid": false, "reason": "..."}`}</InlineCode>.
          You can also send the token as an <InlineCode>X-Agent-Rider</InlineCode>{" "}
          header instead of a body field.
        </p>
      </Section>

      <Section title="Clearance levels">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Riders carry a level, <InlineCode>L0</InlineCode>–<InlineCode>L4</InlineCode>,
          low to high stakes. Check it against the minimum your endpoint
          requires:
        </p>
        <ul style={{ color: "var(--muted)", lineHeight: 1.9, paddingLeft: 20, margin: "0 0 16px" }}>
          <li><InlineCode>L0</InlineCode> — unauthenticated browsing</li>
          <li><InlineCode>L1</InlineCode> — catalog / read access</li>
          <li><InlineCode>L2</InlineCode> — checkout / purchases</li>
          <li><InlineCode>L3</InlineCode>–<InlineCode>L4</InlineCode> — account actions; also checked against revocation</li>
        </ul>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          Pair a level with a scope check (e.g. <InlineCode>purchase:*</InlineCode>)
          for finer-grained gates. See <InlineCode>/api/demo/catalog</InlineCode>,{" "}
          <InlineCode>/api/demo/checkout</InlineCode>, and{" "}
          <InlineCode>/api/demo/account-action</InlineCode> for worked examples
          at L1, L2, and L3.
        </p>
      </Section>

      <Section title="Letting agents discover a rider is required">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          An agent shouldn't need out-of-band knowledge to know it needs a
          rider — the 401 it gets back should tell it. When our own gated
          demo routes (<InlineCode>/api/demo/*</InlineCode>) reject a request
          for a missing or invalid rider, the response is self-describing,
          the same way OAuth's <InlineCode>WWW-Authenticate: Bearer</InlineCode>{" "}
          challenge works:
        </p>
        <CodeBlock>{`HTTP/1.1 401 Unauthorized
WWW-Authenticate: Rider realm="agentrider.dev",
  issue_uri="https://agentrider.vercel.app/api/rider/issue",
  docs_uri="https://agentrider.vercel.app/docs"
Content-Type: application/json

{
  "error": "missing_rider",
  "issue_url": "https://agentrider.vercel.app/api/rider/issue",
  "docs_url": "https://agentrider.vercel.app/docs"
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          Both the header (for clients that parse challenge headers) and the
          body (for anything that just reads JSON) carry the same
          information. If you're building your own gate on top of{" "}
          <InlineCode>checkGate</InlineCode>-equivalent logic, return the same
          shape — it's what turns "access denied" into "here's how to fix
          that," without the agent's operator needing to have read these docs
          in advance.
        </p>
      </Section>

      <Section title="Check your merchant key's status">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Separate from rider verification — this checks whether a merchant
          key itself is currently backed by an active subscription (useful
          for your own dashboard, not for gating agent requests). Rider
          issuance is free; this is what's metered — the first{" "}
          <InlineCode>VERIFY_FREE_CALLS_PER_MONTH</InlineCode> (69 by
          default) calls each calendar month are included in Merchant Gate,
          calls above that keep succeeding but report as billable overage:
        </p>
        <CodeBlock>{`curl -X POST https://agentrider.vercel.app/api/verify \\
  -H "Content-Type: application/json" \\
  -d '{"merchantKey": "merchant_live_..."}'
# => {
#   "valid": true,
#   "status": "active",
#   "usage": { "callsThisMonth": 41, "freeLimit": 69, "overage": false }
# }`}</CodeBlock>
      </Section>

      <Section title="Errors and edge cases">
        <ul style={{ color: "var(--muted)", lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
          <li>
            <InlineCode>/api/rider/issue</InlineCode> returns{" "}
            <InlineCode>401</InlineCode> for a missing key,{" "}
            <InlineCode>402</InlineCode> for an unknown or inactive one.
          </li>
          <li>
            <InlineCode>/api/rider/verify</InlineCode> never calls out to
            Stripe or anything else — it's a pure signature check, so it's
            safe to call on every single gated request without worrying about
            rate limits or latency.
          </li>
          <li>
            A merchant key issued moments ago by the checkout webhook can
            occasionally take a few seconds to become visible to{" "}
            <InlineCode>/api/rider/issue</InlineCode> (Stripe's search API is
            eventually consistent). Retry briefly right after checkout before
            treating a fresh key as invalid.
          </li>
          <li>
            Both endpoints are CORS-enabled — safe to call from a browser or
            server-side.
          </li>
        </ul>
      </Section>
    </main>
  );
}
