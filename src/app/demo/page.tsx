import { RiderMark } from "@/components/RiderMark";

const beforeChecks = [
  "Agent identity re-checked at checkout",
  "Scope re-checked at catalog search",
  "Operator re-checked before account actions",
  "Three round trips before the agent can finish",
];

const afterChecks = [
  "Agent^Rider verifies identity once",
  "Signed rider carries origin, scope, and expiry",
  "Each gate reads the rider locally",
  "One portable proof moves across every step",
];

const benefits = [
  {
    metric: "1x",
    label: "verification event",
    body: "Issue the credential once, then let every gate validate the signed rider instead of rebuilding trust from scratch.",
  },
  {
    metric: "3+",
    label: "systems covered",
    body: "Checkout, catalog, and account systems all consume the same tamper-evident clearance proof.",
  },
  {
    metric: "24h",
    label: "bounded clearance",
    body: "Short-lived riders keep access portable without turning agent approvals into open-ended permissions.",
  },
];

function CheckList({ title, items, tone }: { title: string; items: string[]; tone: "before" | "after" }) {
  const accent = tone === "after" ? "var(--gold)" : "var(--crimson)";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(201, 162, 74, 0.07), var(--panel))",
        border: "1px solid rgba(201, 162, 74, 0.35)",
        borderRadius: 12,
        padding: 26,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: accent,
          marginBottom: 18,
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {items.map((item, index) => (
          <div key={item} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: `1px solid ${accent}`,
                color: accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              {index + 1}
            </span>
            <span style={{ color: "var(--muted)", lineHeight: 1.5 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 80px" }}>
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
          <a href="/docs" style={{ fontSize: 14, color: "var(--muted)" }}>
            Docs
          </a>
          <a href="/#pricing" style={{ fontSize: 14, color: "var(--gold)" }}>
            Get Merchant Gate
          </a>
        </nav>
      </header>

      <section
        className="demo-hero"
        style={{
          display: "grid",
          gridTemplateColumns: "0.9fr 1.1fr",
          gap: 44,
          alignItems: "center",
          padding: "58px 0 72px",
        }}
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
              border: "1px solid rgba(201, 162, 74, 0.35)",
              padding: "5px 10px",
              borderRadius: 3,
              marginBottom: 24,
            }}
          >
            BENEFITS DEMO
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(36px, 5vw, 56px)",
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: "0 0 22px",
            }}
          >
            The rider turns repeated checks into one portable proof.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
            Instead of forcing every merchant system to re-establish agent trust, Agent^Rider issues a signed credential once and lets each gate verify it locally.
          </p>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg, rgba(214, 27, 28, 0.18), rgba(201, 162, 74, 0.12))",
            border: "1px solid rgba(201, 162, 74, 0.35)",
            borderRadius: 16,
            padding: 28,
          }}
        >
          <div style={{ display: "grid", gap: 14, fontFamily: "var(--font-mono)", fontSize: 13 }}>
            <div style={{ color: "var(--muted)" }}>agent.request → checkout</div>
            <div style={{ color: "var(--crimson)" }}>without rider: verify identity + scope</div>
            <div style={{ color: "var(--muted)" }}>agent.request → catalog</div>
            <div style={{ color: "var(--crimson)" }}>without rider: verify identity + scope again</div>
            <div style={{ height: 1, background: "var(--panel-line)", margin: "8px 0" }} />
            <div style={{ color: "var(--gold)" }}>with Agent^Rider: read signed rider at every gate</div>
            <div style={{ color: "var(--white)" }}>result: fewer handoffs, clearer clearance, faster agent flow</div>
          </div>
        </div>
      </section>

      <section className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <CheckList title="WITHOUT AGENT^RIDER" items={beforeChecks} tone="before" />
        <CheckList title="WITH AGENT^RIDER" items={afterChecks} tone="after" />
      </section>

      <section
        className="benefit-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 18,
          paddingTop: 28,
        }}
      >
        {benefits.map((benefit) => (
          <div
            key={benefit.label}
            style={{
              background: "var(--panel)",
              border: "1px solid rgba(201, 162, 74, 0.35)",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--gold)",
                fontSize: 34,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              {benefit.metric}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>{benefit.label}</div>
            <p style={{ color: "var(--muted)", lineHeight: 1.55, margin: 0, fontSize: 14 }}>
              {benefit.body}
            </p>
          </div>
        ))}
      </section>

      <div style={{ textAlign: "center", paddingTop: 44 }}>
        <a
          href="/#pricing"
          style={{
            display: "inline-block",
            padding: "13px 26px",
            background: "linear-gradient(135deg, var(--crimson), var(--gold))",
            boxShadow: "0 12px 30px rgba(201, 162, 74, 0.18)",
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Add Merchant Gate
        </a>
      </div>

      <style>{`
        @media (max-width: 780px) {
          .demo-hero,
          .compare-grid,
          .benefit-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
