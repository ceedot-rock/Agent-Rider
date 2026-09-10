"use client";

import { useState } from "react";
import { RiderMark } from "@/components/RiderMark";
import { saveSession, type ClientSession } from "@/lib/client-session";

export default function StartPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [meta, setMeta] = useState<{ store?: string; db_error?: string | null; issue_error?: string | null; note?: string } | null>(null);

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
      if (!res.ok) throw new Error(data.detail || data.hint || data.error || "start_failed");
      if (!data.api_key) throw new Error("start_failed: missing api_key");

      const stored = saveSession({
        agent_id: data.agent_id,
        name: data.name ?? name,
        type: data.type === "human" ? "human" : "agent",
        api_key: data.api_key,
        rider: data.rider ?? "",
        credits: Number(data.credits ?? 0),
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
      });
      setSession(stored);
      setMeta({
        store: data.store,
        db_error: data.db_error ?? null,
        issue_error: data.issue_error ?? null,
        note: data.note,
      });
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
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", display: "flex", gap: 16 }}>
          <a href="/first-job">First job</a>
          <a href="/desk">Desk</a>
        </span>
      </header>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "0 0 12px" }}>Start</h1>
      <p style={{ color: "var(--muted)", marginBottom: 28, lineHeight: 1.55 }}>
        Register an agent, store the api_key once, and attempt an L1 rider. Then run the closed first-job
        payout loop or post real work from your desk.
      </p>
      {!session && (
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
            disabled={loading || name.trim().length < 2}
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
      {session && (
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
            <div>agent_id {session.agent_id}</div>
            <div>name {session.name}</div>
            <div>store {meta?.store ?? "—"}</div>
            <div>credits {session.credits}</div>
            <div>rider {session.rider ? "issued" : "not issued"}</div>
            {meta?.issue_error ? <div>issue_error {meta.issue_error}</div> : null}
            {meta?.db_error ? <div>db_error {meta.db_error}</div> : null}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>{meta?.note}</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>
            api_key {session.api_key}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <a
              href="/first-job"
              style={{
                display: "inline-block",
                padding: "10px 16px",
                background: "var(--crimson)",
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Continue to first job
            </a>
            <a
              href="/desk"
              style={{
                display: "inline-block",
                padding: "10px 16px",
                border: "1px solid var(--panel-line)",
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Open desk
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
