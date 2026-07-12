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
          Everything a merchant's backend needs to check whether a rider
          presented by an agent is backed by an active Agent^Rider
          subscription.
        </p>
      </div>

      <Section title="1. Subscribe and get a merchant key">
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          Start a Merchant Gate subscription from{" "}
          <a href="/#pricing" style={{ color: "var(--gold)" }}>
            the pricing section
          </a>
          . After checkout, the success page calls{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            GET /api/provision?session_id=...
          </code>{" "}
          and shows your merchant key once. Store it somewhere safe — it
          isn't shown again, and it's the credential every verify call below
          is checked against.
        </p>
      </Section>

      <Section title="2. Verify a rider from your gate">
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Whenever an agent presents a rider at checkout, catalog, or account
          endpoints, have your backend confirm it's still valid before
          proceeding:
        </p>
        <CodeBlock>{`POST /api/verify
Content-Type: application/json

{
  "merchantKey": "rider_live_..."
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>Response:</p>
        <CodeBlock>{`{
  "valid": true,
  "status": "active"
}`}</CodeBlock>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: 0 }}>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>status</code>{" "}
          mirrors the underlying Stripe subscription status —{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            "active"
          </code>{" "}
          or{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            "trialing"
          </code>{" "}
          are the only values that make{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            valid
          </code>{" "}
          true. A cancelled or unrecognized key returns{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            {`{"valid": false, "status": null | "canceled" | ...}`}
          </code>{" "}
          — this is a live check, so cancelling a subscription revokes access
          automatically without any extra step on your side.
        </p>
      </Section>

      <Section title="Example: curl">
        <CodeBlock>{`curl -X POST https://agentrider.vercel.app/api/verify \\
  -H "Content-Type: application/json" \\
  -d '{"merchantKey": "rider_live_..."}'`}</CodeBlock>
      </Section>

      <Section title="Example: fetch (Node or browser)">
        <CodeBlock>{`const res = await fetch("https://agentrider.vercel.app/api/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ merchantKey }),
});
const { valid, status } = await res.json();

if (!valid) {
  // reject the request — key is missing, unknown, or subscription is
  // not active/trialing
}`}</CodeBlock>
      </Section>

      <Section title="Errors and edge cases">
        <ul style={{ color: "var(--muted)", lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
          <li>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
              400
            </code>{" "}
            — request body missing{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
              merchantKey
            </code>
            .
          </li>
          <li>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
              500
            </code>{" "}
            — verification failed on our end; treat as unverified and retry,
            don't treat as a valid rider.
          </li>
          <li>
            The endpoint is CORS-enabled (
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
              Access-Control-Allow-Origin: *
            </code>
            ), so it's safe to call directly from a browser as well as
            server-side.
          </li>
          <li>
            A key issued moments ago by the checkout webhook can occasionally
            take a few seconds to become visible to verify (Stripe's search
            API is eventually consistent). If you're testing immediately
            after checkout, retry briefly before treating a fresh key as
            invalid.
          </li>
        </ul>
      </Section>
    </main>
  );
}
