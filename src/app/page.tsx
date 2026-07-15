"use client";

import { useState } from "react";
import { RiderMark } from "@/components/RiderMark";

const STEPS = [
  {
    n: "01",
    label: "Request",
    body: "Before your agent touches a new system, you ask Agent^Rider for a credential on its behalf.",
  },
  {
    n: "02",
    label: "Verify",
    body: "We run the identity and clearance checks once — origin network, operator, scope. You don't build that pipeline yourself.",
  },
  {
    n: "03",
    label: "Issue",
    body: "A signed rider comes back: a compact, tamper-evident proof of who's asking and what they're cleared for. Expires automatically.",
  },
  {
    n: "04",
    label: "Present",
    body: "Every gate your agent crosses reads the rider directly, for free, in milliseconds. No re-vetting, no call back to you.",
  },
];

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "28px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
        </div>
        <nav style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <a
            href="#pipeline"
            style={{ fontSize: 14, color: "var(--muted)" }}
          >
            How it works
          </a>
          <a href="/board" style={{ fontSize: 14, color: "var(--muted)" }}>
            Board
          </a>
          <a href="/demo" style={{ fontSize: 14, color: "var(--muted)" }}>
            Demo
          </a>
          <a href="/docs" style={{ fontSize: 14, color: "var(--muted)" }}>
            Docs
          </a>
          <a href="#pricing" style={{ fontSize: 14, color: "var(--muted)" }}>
            Pricing
          </a>
          <a
            href="#pricing"
            style={{
              fontSize: 14,
              fontWeight: 600,
              padding: "9px 18px",
              borderRadius: 4,
              background: "var(--crimson)",
              color: "var(--white)",
            }}
          >
            Get Merchant Gate
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 56,
          alignItems: "center",
          padding: "64px 0 88px",
        }}
        className="hero-grid"
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--gold)",
              border: "1px solid var(--panel-line)",
              padding: "5px 10px",
              borderRadius: 3,
              marginBottom: 24,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--crimson)",
                display: "inline-block",
              }}
            />
            FOR TEAMS RUNNING AI AGENTS IN PRODUCTION
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(38px, 5vw, 58px)",
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: "0 0 22px",
            }}
          >
            Stop making your agents
            <br />
            re-prove themselves <span style={{ color: "var(--crimson)" }}>every time</span>.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: "var(--muted)",
              maxWidth: 480,
              margin: "0 0 32px",
            }}
          >
            Every new API your agents touch means rebuilding trust from
            zero — or you building your own identity system to avoid it.
            Agent^Rider issues a signed, tamper-evident credential for each
            agent your fleet runs. Any gate verifies it locally, for free,
            in milliseconds — no callback, no re-vetting.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <a
              href="#pricing"
              style={{
                padding: "13px 26px",
                background: "var(--crimson)",
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              Get Merchant Gate — $11.99/mo
            </a>
            <a
              href="/demo"
              style={{
                padding: "13px 26px",
                border: "1px solid var(--panel-line)",
                borderRadius: 4,
                fontSize: 15,
                color: "var(--white)",
              }}
            >
              See a live gate check
            </a>
          </div>
        </div>

        {/* Signature element: the credential card */}
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 10,
            padding: 28,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "var(--crimson)",
              opacity: 0.12,
              filter: "blur(40px)",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 18,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: "0.05em",
              }}
            >
              RIDER CREDENTIAL
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--gold)",
                border: "1px solid var(--gold)",
                borderRadius: 3,
                padding: "2px 7px",
              }}
            >
              VERIFIED
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--white)",
              lineHeight: 1.9,
            }}
          >
            <div>
              <span style={{ color: "var(--muted)" }}>agent_id</span>{" "}
              a7f2-rider-9c14
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>origin</span>{" "}
              network.acme-fleet
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>clearance</span>{" "}
              checkout · catalog
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>issued</span> just now
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>expires</span> 24h
            </div>
          </div>
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: "1px dashed var(--panel-line)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <RiderMark size={22} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Signed once. Presented at every gate.
            </span>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section id="pipeline" style={{ padding: "40px 0 88px" }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          How your agents get (and prove) trust
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: 40, maxWidth: 560 }}>
          This is the actual order a request moves through — not a marketing
          sequence.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 1,
            background: "var(--panel-line)",
            borderRadius: 10,
            overflow: "hidden",
          }}
          className="pipeline-grid"
        >
          {STEPS.map((s) => (
            <div key={s.n} style={{ background: "var(--panel)", padding: 24 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--gold)",
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 16,
                  marginBottom: 8,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Proof: real request/response, not a mockup */}
      <section style={{ padding: "0 0 88px" }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          The actual API, not a mockup
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: 32, maxWidth: 560 }}>
          Two calls. Issuing a rider needs your merchant key; verifying one
          doesn't — any system your agent talks to can check it for free.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
          className="proof-grid"
        >
          <pre
            style={{
              background: "var(--bg)",
              border: "1px solid var(--panel-line)",
              borderRadius: 8,
              padding: "16px 18px",
              overflowX: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "var(--white)",
              margin: 0,
            }}
          >
            <code>{`POST /api/rider/issue
X-Merchant-Key: merchant_live_...

{
  "agent_id": "a7f2-rider-9c14",
  "operator_id": "network.acme-fleet",
  "level": "L2"
}

→ { "rider": "eyJhbGciOiJFUzI1NiIs...",
    "expires_in": 900 }`}</code>
          </pre>
          <pre
            style={{
              background: "var(--bg)",
              border: "1px solid var(--panel-line)",
              borderRadius: 8,
              padding: "16px 18px",
              overflowX: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "var(--white)",
              margin: 0,
            }}
          >
            <code>{`POST /api/rider/verify
(no auth required — free, local check)

{ "rider": "eyJhbGciOiJFUzI1NiIs..." }

→ { "valid": true,
    "rider": { "agent_id": "a7f2-rider-9c14",
               "level": "L2" } }`}</code>
          </pre>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 20 }}>
          Full contract, error codes, and clearance levels in{" "}
          <a href="/docs" style={{ color: "var(--gold)" }}>
            the docs
          </a>
          , or run it live in{" "}
          <a href="/demo" style={{ color: "var(--gold)" }}>
            the demo
          </a>
          .
        </p>
      </section>

      {/* Pricing / Checkout */}
      <section
        id="pricing"
        style={{
          padding: "0 0 100px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 12,
            padding: 40,
            maxWidth: 420,
            width: "100%",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--gold)",
              marginBottom: 6,
            }}
          >
            MERCHANT GATE — BASE
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 18 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 700 }}>
              $11.99
            </span>
            <span style={{ color: "var(--muted)", fontSize: 15 }}>/month</span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 28px",
              fontSize: 14,
              color: "var(--muted)",
              lineHeight: 2,
            }}
          >
            <li>Rider issuance API for your agents</li>
            <li>L0–L4 clearance levels + scopes</li>
            <li>Unlimited free verification, for any gate</li>
            <li>Self-describing 401s agents can follow</li>
          </ul>
          <input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "var(--bg)",
              border: "1px solid var(--panel-line)",
              borderRadius: 6,
              color: "var(--white)",
              fontSize: 14,
              marginBottom: 14,
            }}
          />
          <button
            onClick={startCheckout}
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              background: loading ? "var(--crimson-dim)" : "var(--crimson)",
              border: "none",
              borderRadius: 6,
              color: "var(--white)",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            {loading ? "Redirecting to checkout…" : "Subscribe to Merchant Gate"}
          </button>
          {error && (
            <p style={{ color: "var(--crimson)", fontSize: 13, marginTop: 10 }}>
              {error}
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
            Billed monthly via Stripe. Cancel anytime.
          </p>
        </div>
      </section>

      <footer
        style={{
          borderTop: "1px solid var(--panel-line)",
          padding: "28px 0",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        <span>Agent^Rider</span>
        <span>Portable trust for AI agents</span>
      </footer>

      <style jsx>{`
        @media (max-width: 780px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
          }
          .pipeline-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .proof-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
