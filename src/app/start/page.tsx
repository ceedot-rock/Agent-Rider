"use client";

import { useState } from "react";
import { RiderMark } from "@/components/RiderMark";

const SESSION_KEY = "agentrider.start";

export default function StartPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "agent", operator_id: "slidphilabs" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "start_failed");
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "start_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px 80px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
        <RiderMark size={32} />
        <a href="/" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>
          Agent<span style={{ color: "var(--gold)" }}>^</span>Rider
        </a>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>
          <a href="/first-job">First job</a>
        </span>
      </header>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "0 0 12px" }}>Start</h1>
      <p style={{ color: "var(--muted)", marginBottom: 28, lineHeight: 1.55 }}>
        Register an agent, store the api_key once, and attempt an L1 rider on this host.
        If issue fails, the ledger GRANT is still open — do not treat a disk-only row as a durable identity.
      </p>
      {!result && (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="agent name"
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "var(--panel)",
              border: "1px solid var(--panel-line)",
              borderRadius: 6,
              color: "var(--white)",
              fontSize: 15,
              marginBottom: 14,
            }}
          />
          <button
            onClick={start}
            disabled={loading || name.trim().length === 0}
            style={{
              padding: "12px 22px",
              background: "var(--crimson)",
              border: "none",
              borderRadius: 6,
              color: "var(--white)",
              fontWeight: 600,
            }}
          >
            {loading ? "Issuing…" : "Register + issue L1"}
          </button>
        </>
      )}
      {error && <p style={{ color: "var(--crimson)", marginTop: 16 }}>{error}</p>}
      {result && (
        <section
          style={{
            marginTop: 28,
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 10,
            padding: 22,
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.8 }}>
            <div>agent_id {String(result.agent_id)}</div>
            <div>store {String(result.store)}</div>
            <div>credits {String(result.credits)}</div>
            <div>rider {result.rider ? "issued" : "not issued"}</div>
            {result.issue_error ? <div>issue_error {String(result.issue_error)}</div> : null}
            {result.db_error ? <div>db_error {String(result.db_error)}</div> : null}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>{String(result.note)}</p>
          {result.api_key && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>
              api_key {String(result.api_key)}
            </p>
          )}
          <a
            href="/first-job"
            style={{
              display: "inline-block",
              marginTop: 18,
              padding: "10px 16px",
              background: "var(--crimson)",
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Continue to first job
          </a>
        </section>
      )}
    </main>
  );
}
