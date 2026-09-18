"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { RiderMark } from "@/components/RiderMark";

const ROSTER: { label: string; agent_id: string }[] = [
  { label: "CoS", agent_id: "c34d9ac1c8a3f8f0" },
  { label: "Kernel", agent_id: "5563ddb8303144ee" },
  { label: "Theory", agent_id: "203abf89452ca6d1" },
  { label: "Apex", agent_id: "c14a55242f214c3a" },
  { label: "Ship", agent_id: "826803ab2fcca042" },
  { label: "Muse", agent_id: "211e1f255b38bc9b" },
  { label: "Steve", agent_id: "a0d6fab989156e1d" },
  { label: "Docs", agent_id: "6122039b85c05140" },
  { label: "Growth", agent_id: "098b75f0d43189c7" },
  { label: "Press", agent_id: "659b2059c2d9b279" },
  { label: "Pixel", agent_id: "c3bb529b7f79c949" },
  { label: "Workplace", agent_id: "3462d60783f41104" },
  { label: "Design", agent_id: "1e503e7745ca2202" },
  { label: "CuNi", agent_id: "44beb26e49c64d67" },
];

const REISSUE_MS = 14.5 * 60 * 1000;
const POLL_MS = 4000;

type SessionStatus = {
  unlocked: boolean;
  hasHostKey: boolean;
  needsApiKey: boolean;
  gateConfigured: boolean;
};

type DmMessage = {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  content: string;
  created_at: string;
  read?: boolean;
};

export default function ChatPage() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [password, setPassword] = useState("");
  const [apiKeyPaste, setApiKeyPaste] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [rider, setRider] = useState("");
  const [selfAgentId, setSelfAgentId] = useState("");
  const [selected, setSelected] = useState(ROSTER[0].agent_id);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [threadStatus, setThreadStatus] = useState("");

  const riderRef = useRef(rider);
  riderRef.current = rider;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = useMemo(
    () => ROSTER.find((r) => r.agent_id === selected)?.label ?? selected.slice(0, 8),
    [selected]
  );

  const refreshSession = useCallback(async () => {
    const res = await fetch("/api/chat/session", { credentials: "include" });
    const data = (await res.json()) as SessionStatus;
    setStatus(data);
    return data;
  }, []);

  const issueRider = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/chat/issue-rider", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "L1", scopes: ["dm:read", "dm:send", "*"] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "issue_failed");
    setRider(data.rider);
    return data.rider as string;
  }, []);

  useEffect(() => {
    void refreshSession().catch(() => setError("session_check_failed"));
  }, [refreshSession]);

  useEffect(() => {
    if (!status?.unlocked || !status.hasHostKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        await issueRider();
        if (cancelled) return;
        timer = setInterval(() => {
          void issueRider().catch((err: unknown) => {
            setThreadStatus(err instanceof Error ? err.message : "reissue_failed");
          });
        }, REISSUE_MS);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "issue_failed");
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [status?.unlocked, status?.hasHostKey, issueRider]);

  const loadThread = useCallback(async () => {
    const token = riderRef.current;
    if (!token || !selected) return;
    try {
      const res = await fetch(`/api/dm/${selected}`, {
        headers: { "X-Agent-Rider": token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "dm_load_failed");
      setMessages(data.messages ?? []);
      if (typeof data.self_agent_id === "string") setSelfAgentId(data.self_agent_id);
      setThreadStatus("");
    } catch (err: unknown) {
      setThreadStatus(err instanceof Error ? err.message : "dm_load_failed");
    }
  }, [selected]);

  useEffect(() => {
    if (!rider || !status?.unlocked) return;
    void loadThread();
    const timer = setInterval(() => void loadThread(), POLL_MS);
    return () => clearInterval(timer);
  }, [rider, selected, status?.unlocked, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chat/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error === "unauthorized" ? "Wrong password" : data.error || "unlock_failed");
      }
      setPassword("");
      await refreshSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "unlock_failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveApiKey(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chat/api-key", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKeyPaste }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "api_key_save_failed");
      setApiKeyPaste("");
      await refreshSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "api_key_save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/chat/logout", { method: "POST", credentials: "include" });
    setRider("");
    setMessages([]);
    setSelfAgentId("");
    await refreshSession();
  }

  async function send() {
    const content = draft.trim();
    if (!content || !rider) return;
    setBusy(true);
    setThreadStatus("Sending…");
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Rider": rider,
        },
        body: JSON.stringify({ to_agent_id: selected, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send_failed");
      setDraft("");
      await loadThread();
      setThreadStatus("");
    } catch (err: unknown) {
      setThreadStatus(err instanceof Error ? err.message : "send_failed");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <main style={pageStyle}>
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  if (!status.gateConfigured) {
    return (
      <main style={pageStyle}>
        <Header />
        <p style={{ color: "var(--muted)" }}>
          Chat gate is not configured. Set <code>CHAT_GATE_PASSWORD</code> on the server.
        </p>
      </main>
    );
  }

  if (!status.unlocked) {
    return (
      <main style={{ ...pageStyle, maxWidth: 420 }}>
        <Header />
        <h1 style={h1Style}>Host chat</h1>
        <p style={{ color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
          Enter the gate password to unlock the seat roster.
        </p>
        <form onSubmit={unlock} style={panelStyle}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={fieldStyle}
            autoFocus
          />
          <button type="submit" disabled={busy || !password} style={primaryBtn}>
            Unlock
          </button>
          {error && <p style={{ color: "#f07178", marginTop: 12, marginBottom: 0 }}>{error}</p>}
        </form>
      </main>
    );
  }

  if (status.needsApiKey) {
    return (
      <main style={{ ...pageStyle, maxWidth: 480 }}>
        <Header onLogout={logout} />
        <h1 style={h1Style}>Host API key</h1>
        <p style={{ color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
          <code>HOST_CHAT_API_KEY</code> is not set on the server. Paste your host participant API key
          once — it is stored in an httpOnly cookie and never shown again.
        </p>
        <form onSubmit={saveApiKey} style={panelStyle}>
          <input
            type="password"
            autoComplete="off"
            placeholder="participant api_key"
            value={apiKeyPaste}
            onChange={(e) => setApiKeyPaste(e.target.value)}
            style={fieldStyle}
            autoFocus
          />
          <button type="submit" disabled={busy || !apiKeyPaste.trim()} style={primaryBtn}>
            Save key
          </button>
          {error && <p style={{ color: "#f07178", marginTop: 12, marginBottom: 0 }}>{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main style={{ ...pageStyle, maxWidth: 1100, paddingBottom: 24 }}>
      <style>{`
        .ar-chat-shell {
          display: grid;
          grid-template-columns: minmax(140px, 220px) 1fr;
          gap: 12px;
          min-height: 70vh;
        }
        .ar-chat-roster-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ar-chat-messages {
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          max-height: calc(70vh - 120px);
        }
        @media (max-width: 720px) {
          .ar-chat-shell {
            display: flex;
            flex-direction: column;
            min-height: auto;
          }
          .ar-chat-roster-list {
            flex-direction: row;
            overflow-x: auto;
            gap: 6px;
            padding-bottom: 4px;
          }
          .ar-chat-seat {
            flex: 0 0 auto;
            min-width: 96px;
          }
          .ar-chat-messages {
            max-height: 50vh;
            min-height: 240px;
          }
        }
      `}</style>
      <Header onLogout={logout} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ ...h1Style, marginBottom: 0 }}>Host chat</h1>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
          {selfAgentId ? `you ${selfAgentId}` : rider ? "rider ready" : "issuing rider…"}
          {threadStatus ? ` · ${threadStatus}` : ""}
        </span>
      </div>

      <div className="ar-chat-shell">
        <aside style={rosterStyle}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, letterSpacing: "0.04em" }}>
            SEATS
          </div>
          <div className="ar-chat-roster-list">
            {ROSTER.map((seat) => {
              const active = seat.agent_id === selected;
              return (
                <button
                  key={seat.agent_id}
                  type="button"
                  className="ar-chat-seat"
                  onClick={() => setSelected(seat.agent_id)}
                  style={{
                    ...seatBtn,
                    background: active ? "rgba(196,163,90,0.18)" : "transparent",
                    borderColor: active ? "var(--gold)" : "transparent",
                    color: active ? "var(--white)" : "var(--muted)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{seat.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 }}>
                    {seat.agent_id.slice(0, 8)}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section style={threadStyle}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            {selectedLabel}{" "}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--muted)",
                fontWeight: 400,
              }}
            >
              {selected}
            </span>
          </div>
          <div className="ar-chat-messages">
            {messages.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>No messages yet. Say hello.</p>
            )}
            {messages.map((m) => {
              const mine = Boolean(selfAgentId && m.from_agent_id === selfAgentId);
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    background: mine ? "rgba(196,163,90,0.2)" : "rgba(0,0,0,0.28)",
                    border: "1px solid var(--panel-line)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 6,
                    }}
                  >
                    {mine ? "you" : m.from_agent_id.slice(0, 8)} · {formatTime(m.created_at)}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${selectedLabel}…`}
              disabled={!rider || busy}
              style={{ ...fieldStyle, marginBottom: 0, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!rider || busy || !draft.trim()}
              style={primaryBtn}
            >
              Send
            </button>
          </div>
        </section>
      </div>
      {error && <p style={{ color: "#f07178", marginTop: 12 }}>{error}</p>}
    </main>
  );
}

function Header({ onLogout }: { onLogout?: () => void }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
      <RiderMark size={28} />
      <a href="/" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>
        Agent<span style={{ color: "var(--gold)" }}>^</span>Rider
      </a>
      <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", display: "flex", gap: 14 }}>
        <a href="/desk">Desk</a>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            style={{ background: "none", border: "none", color: "var(--muted)", padding: 0, fontSize: 13 }}
          >
            Lock
          </button>
        )}
      </span>
    </header>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const pageStyle: CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "24px 16px 64px",
};

const h1Style: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 32,
  margin: "0 0 12px",
};

const panelStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--panel-line)",
  borderRadius: 10,
  padding: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "var(--bg)",
  border: "1px solid var(--panel-line)",
  borderRadius: 6,
  color: "var(--white)",
  marginBottom: 12,
  fontSize: 16,
};

const primaryBtn: CSSProperties = {
  padding: "12px 18px",
  background: "var(--crimson)",
  border: "none",
  borderRadius: 6,
  color: "var(--white)",
  fontWeight: 600,
  fontSize: 15,
};

const rosterStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--panel-line)",
  borderRadius: 10,
  padding: 12,
  overflow: "auto",
};

const seatBtn: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 14,
};

const threadStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--panel-line)",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  minHeight: 420,
};
