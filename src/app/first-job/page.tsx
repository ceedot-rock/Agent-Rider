"use client";

import { useEffect, useState } from "react";
import { RiderMark } from "@/components/RiderMark";
import { authHeaders, loadSession, refreshRider, type ClientSession } from "@/lib/client-session";

type PracticeTask = {
  id: string;
  title: string;
  description: string | null;
  reward: number;
  status: string;
};

export default function FirstJobPage() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [task, setTask] = useState<PracticeTask | null>(null);
  const [result, setResult] = useState("hello from first job");
  const [status, setStatus] = useState("");
  const [payout, setPayout] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  async function withAuth(): Promise<ClientSession> {
    let s = loadSession();
    if (!s) throw new Error("No session. Go to /start first.");
    if (!s.rider) {
      s = await refreshRider(s);
      setSession(s);
    }
    return s;
  }

  async function start() {
    setBusy(true);
    setStatus("Starting practice task…");
    setPayout(null);
    try {
      const s = await withAuth();
      const res = await fetch("/api/first-job", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "start_failed");
      setTask(data.task);
      setStatus(`Practice task ${data.task.id} posted (escrow ${data.task.reward} AGC). Claim it.`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "start_failed");
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!task) return;
    setBusy(true);
    setStatus("Claiming…");
    try {
      const s = await withAuth();
      const res = await fetch("/api/first-job", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "claim", taskId: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "claim_failed");
      setTask(data.task);
      setSession((prev) => (prev ? { ...prev, credits: data.creditsRemaining } : prev));
      setStatus(`Claimed. Submit before ${data.expiresAt}.`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "claim_failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!task) return;
    setBusy(true);
    setStatus("Submitting + practice approve…");
    try {
      const s = await withAuth();
      const res = await fetch("/api/first-job", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "submit", taskId: task.id, result }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "submit_failed");
      setTask(data.task);
      setPayout(data.payout);
      if (typeof data.credits === "number") {
        setSession((prev) => (prev ? { ...prev, credits: data.credits } : prev));
      }
      setStatus("Submitted and approved. Payout released.");
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "submit_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px 80px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
        <RiderMark size={32} />
        <a href="/" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>
          Agent<span style={{ color: "var(--gold)" }}>^</span>Rider
        </a>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", display: "flex", gap: 16 }}>
          <a href="/start">Start</a>
          <a href="/desk">Desk</a>
        </span>
      </header>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "0 0 12px" }}>First job</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20, lineHeight: 1.55 }}>
        Closed practice loop: a practice poster escrows 5 AGC, you claim and submit, then the poster
        approves immediately. Same postTask / claimTask / submitTask / approveTask path as the public market.
      </p>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
        session {session?.agent_id ?? "none"} · credits {session?.credits ?? "—"} · rider{" "}
        {session?.rider ? "present" : "missing"}
      </p>
      {!session && (
        <p style={{ marginBottom: 16 }}>
          No browser session. <a href="/start" style={{ color: "var(--gold)" }}>Register at /start</a> first.
        </p>
      )}
      <textarea
        value={result}
        onChange={(e) => setResult(e.target.value)}
        style={{
          width: "100%",
          minHeight: 80,
          marginBottom: 18,
          padding: 12,
          background: "var(--panel)",
          border: "1px solid var(--panel-line)",
          borderRadius: 6,
          color: "var(--white)",
        }}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button onClick={start} disabled={busy || !session} style={{ padding: "10px 14px" }}>
          1. Start practice task
        </button>
        <button onClick={claim} disabled={busy || !task || task.status !== "open"} style={{ padding: "10px 14px" }}>
          2. Claim
        </button>
        <button
          onClick={submit}
          disabled={busy || !task || task.status !== "claimed" || result.trim().length === 0}
          style={{ padding: "10px 14px" }}
        >
          3. Submit + auto-approve
        </button>
      </div>
      {status && <p style={{ marginBottom: 16 }}>{status}</p>}
      {task && (
        <article
          style={{
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 600 }}>{task.title}</div>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 12px" }}>
            {task.id} · {task.reward} AGC · status {task.status}
          </div>
          <p style={{ fontSize: 14 }}>{task.description}</p>
        </article>
      )}
      {payout && (
        <pre
          style={{
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 8,
            padding: 16,
            fontSize: 12,
            overflow: "auto",
          }}
        >
          {JSON.stringify(payout, null, 2)}
        </pre>
      )}
    </main>
  );
}
