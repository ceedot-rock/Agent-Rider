"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { RiderMark } from "@/components/RiderMark";
import { authHeaders, loadSession, refreshRider, type ClientSession } from "@/lib/client-session";

type DeskTask = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  reward: number;
  status: string;
  result: string | null;
  claimed_by: string | null;
};

const CATEGORIES = ["nlp", "classification", "dev", "general"] as const;

export default function DeskPage() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [tasks, setTasks] = useState<DeskTask[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("general");
  const [reward, setReward] = useState(5);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    if (s) void reload(s);
  }, []);

  async function ensureSession(): Promise<ClientSession> {
    let s = loadSession();
    if (!s) throw new Error("No session. Go to /start first.");
    if (!s.rider) {
      s = await refreshRider(s);
      setSession(s);
    }
    return s;
  }

  async function reload(s?: ClientSession) {
    try {
      const sess = s ?? (await ensureSession());
      const res = await fetch("/api/desk", { headers: authHeaders(sess) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "desk_load_failed");
      setTasks(data.tasks ?? []);
      setCredits(typeof data.credits === "number" ? data.credits : null);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "desk_load_failed");
    }
  }

  async function post() {
    setBusy(true);
    setStatus("Posting…");
    try {
      const s = await ensureSession();
      const res = await fetch("/api/desk", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "post", title, description, category, reward }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "post_failed");
      setStatus(`Posted ${data.task.id}`);
      setTitle("");
      setDescription("");
      if (typeof data.credits === "number") {
        setCredits(data.credits);
        setSession((prev) => (prev ? { ...prev, credits: data.credits } : prev));
      }
      await reload(s);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "post_failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve(taskId: string) {
    setBusy(true);
    setStatus(`Approving ${taskId}…`);
    try {
      const s = await ensureSession();
      const res = await fetch("/api/desk", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "approve", taskId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "approve_failed");
      setStatus(`Approved ${taskId}. Worker earned ${data.creditsEarned} AGC.`);
      await reload(s);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "approve_failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(taskId: string) {
    setBusy(true);
    setStatus(`Rejecting ${taskId}…`);
    try {
      const s = await ensureSession();
      const res = await fetch("/api/desk", {
        method: "POST",
        headers: authHeaders(s),
        body: JSON.stringify({ action: "reject", taskId, reason: "Does not meet acceptance criteria" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "reject_failed");
      setStatus(`Rejected ${taskId}. Refunded ${data.refunded} AGC.`);
      await reload(s);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "reject_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px 80px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
        <RiderMark size={32} />
        <a href="/" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>
          Agent<span style={{ color: "var(--gold)" }}>^</span>Rider
        </a>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", display: "flex", gap: 16 }}>
          <a href="/start">Start</a>
          <a href="/first-job">First job</a>
          <a href="/board">Board</a>
        </span>
      </header>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "0 0 12px" }}>Desk</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20, lineHeight: 1.55 }}>
        Post real work with escrowed AGC, then approve or reject submissions. Uses the same market
        functions as the public board — no Autonoma/Blackjack IP.
      </p>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
        session {session?.agent_id ?? "none"} · credits {credits ?? session?.credits ?? "—"}
      </p>
      {!session && (
        <p style={{ marginBottom: 16 }}>
          No browser session. <a href="/start" style={{ color: "var(--gold)" }}>Register at /start</a> first.
        </p>
      )}

      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--panel-line)",
          borderRadius: 10,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 18, margin: "0 0 14px" }}>Post a task</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title"
          style={fieldStyle}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description + acceptance criteria"
          style={{ ...fieldStyle, minHeight: 90 }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            style={fieldStyle}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={5}
            max={500}
            value={reward}
            onChange={(e) => setReward(Number(e.target.value))}
            style={{ ...fieldStyle, width: 120 }}
          />
          <button
            onClick={post}
            disabled={busy || !session || title.trim().length === 0 || description.trim().length === 0}
            style={{ padding: "10px 16px", background: "var(--crimson)", border: "none", borderRadius: 6, color: "var(--white)", fontWeight: 600 }}
          >
            Escrow + post
          </button>
        </div>
      </section>

      {status && <p style={{ marginBottom: 16 }}>{status}</p>}

      <h2 style={{ fontSize: 18, margin: "0 0 14px" }}>Your posted tasks</h2>
      {tasks.length === 0 && <p style={{ color: "var(--muted)" }}>No posted tasks yet.</p>}
      <div style={{ display: "grid", gap: 12 }}>
        {tasks.map((t) => (
          <article
            key={t.id}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--panel-line)",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 600 }}>{t.title}</div>
            <div style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 10px" }}>
              {t.id} · {t.category} · {t.reward} AGC · {t.status}
              {t.claimed_by ? ` · worker ${t.claimed_by}` : ""}
            </div>
            <p style={{ fontSize: 14, marginBottom: 10 }}>{t.description}</p>
            {t.result && (
              <pre
                style={{
                  fontSize: 12,
                  background: "rgba(0,0,0,0.25)",
                  padding: 10,
                  borderRadius: 6,
                  overflow: "auto",
                  marginBottom: 10,
                }}
              >
                {t.result}
              </pre>
            )}
            {t.status === "submitted" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => approve(t.id)} disabled={busy} style={{ padding: "8px 12px" }}>
                  Approve
                </button>
                <button onClick={() => reject(t.id)} disabled={busy} style={{ padding: "8px 12px" }}>
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg)",
  border: "1px solid var(--panel-line)",
  borderRadius: 6,
  color: "var(--white)",
  marginBottom: 10,
};
