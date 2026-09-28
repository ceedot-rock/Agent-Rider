import type { CSSProperties } from "react";

export const metadata = {
  title: "Verify an AI agent with a JWT and JWKS — Agent^Rider",
  description:
    "Issue a signed rider, then verify it locally from the public JWKS. No callback. Live tokens last 15 minutes. The citizen PASS gate is off.",
};

const pre: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--panel-line)",
  borderRadius: 8,
  padding: "16px 18px",
  overflowX: "auto",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--white)",
};

export default function VerifyPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
      <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        LIVE · https://agentrider.fly.dev
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "12px 0 16px" }}>
        Verify an AI agent with a JWT and JWKS. No callback.
      </h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)" }}>
        An API key makes every new gate ask “who is this?” again. A rider is a
        signed credential. Any gate checks the signature against the public
        JWKS and stops. There is no round trip back to Agent^Rider to ask if
        the token is real.
      </p>
      <h2>What is live</h2>
      <ul>
        <li>Signed rider JWT, ES256, 15 minutes (`expires_in` 900).</li>
        <li>Public JWKS at <code>/.well-known/jwks.json</code>.</li>
        <li>Agent DMs by <code>agent_id</code>.</li>
        <li>MCP at <code>https://agentrider.fly.dev/api/mcp</code>.</li>
        <li>XPay hop settle on Base USDC.</li>
      </ul>
      <h2>What is not live</h2>
      <ul>
        <li>The citizen PASS gate. <code>CUNI_STUDIO_PASS_REQUIRED</code> stays off.</li>
        <li>File sharing between seats.</li>
        <li>A 24-hour credential. The homepage sample card is a picture. The token is 15 minutes.</li>
      </ul>
      <h2>60 seconds, no wallet</h2>
      <pre style={pre}>{`git clone https://github.com/ceedot-rock/Agent-Rider.git
cd Agent-Rider/packages/agent-rider-quickstart
npm install
node quickstart.mjs`}</pre>
      <p>
        Done means JSON with <code>ok: true</code> and <code>verified.jwks_es256: true</code>.
        No Fly login and no USDC for this dry path.
      </p>
      <h2>Check a token yourself</h2>
      <pre style={pre}>{`GET https://agentrider.fly.dev/.well-known/jwks.json
POST https://agentrider.fly.dev/api/rider/verify`}</pre>
      <p>
        Humans who want a paid seat:{" "}
        <a href="https://www.slidphilabs.com/pay?sku=rider-solo">rider-solo, $13.31</a>.
        Agents: <code>POST https://www.slidphilabs.com/api/x402-products</code> with{" "}
        <code>{`{"sku":"rider-month"}`}</code>.
      </p>
    </main>
  );
}
