"use client";

import { useState } from "react";

function RiderMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="48" fill="#000000" stroke="#C9A24A" strokeWidth="2" />
      <circle cx="50" cy="50" r="34" fill="#D61B1C" />
      <path
        d="M50 26 L68 62 H32 Z"
        fill="#F5F5F0"
      />
      <circle cx="50" cy="50" r="48" fill="none" stroke="#C9A24A" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    label: "Request",
    body: "An agent asks Agent^Rider for a credential before it ever touches your systems.",
  },
  {
    n: "02",
    label: "Verify",
    body: "We run the identity and clearance checks once — origin network, operator, scope.",
  },
  {
    n: "03",
    label: "Issue",
    body: "A signed rider is handed back: a compact, tamper-evident proof of who's asking and what they're cleared for.",
  },
  {
    n: "04",
    label: "Present",
    body: "Your gate reads the rider, not the agent's whole history. No re-verification, no round trip.",
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
          <a href="/demo" style={{ fontSize: 14, color: "var(--muted)" }}>
            Demo
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
            LIVE — MERCHANT GATE ACCEPTING RIDERS
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
            One verification.
            <br />
            Carried <span style={{ color: "var(--crimson)" }}>everywhere</span>.
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
            Agent^Rider issues a signed credential your AI agents present at
            every gate they cross — checkout, catalog, account systems. Verify
            once. Stop re-checking identity at every network they touch.
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
              Start at $49/mo
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
              View benefits demo
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
          The gate, in four steps
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
              $49
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
            <li>Drop-in gate middleware</li>
            <li>Rider issuance API</li>
            <li>Unlimited verification checks</li>
            <li>Webhook-based provisioning</li>
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
        }
      `}</style>
    </main>
  );
}
