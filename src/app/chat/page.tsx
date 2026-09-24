"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { RiderMark } from "@/components/RiderMark";

type Seat = { name: string; agent_id: string };
type Room = { id: string; name: string; kind: "channel"; description?: string };

const PASTE_KEY = "host_chat_api_key";
const RIDER_CACHE_KEY = "host_chat_rider";
const POLL_MS = 4000;
const RIDER_REFRESH_BUFFER_MS = 60_000;
const LAB_TEAM_ROOM_ID = "lab-team";

type ChatMessage = {
  id: string;
  from_agent_id: string;
  content: string;
  created_at: string;
  read?: boolean;
  channel_id?: string;
};

type RiderCache = { token: string; expires_at: number; self_agent_id?: string };

type Selection =
  | { kind: "channel"; id: string }
  | { kind: "dm"; id: string };

function loadPasteKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(PASTE_KEY) ?? "";
}

function savePasteKey(key: string) {
  window.sessionStorage.setItem(PASTE_KEY, key);
}

function loadRiderCache(): RiderCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RIDER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RiderCache;
  } catch {
    return null;
  }
}

function saveRiderCache(cache: RiderCache) {
  window.sessionStorage.setItem(RIDER_CACHE_KEY, JSON.stringify(cache));
}

function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function applyConfig(
  c: { has_server_key?: boolean; seats?: Seat[]; rooms?: Room[] },
  setHasServerKey: (v: boolean) => void,
  setSeats: (v: Seat[]) => void,
  setRooms: (v: Room[]) => void,
  setSelection: (updater: (prev: Selection | null) => Selection | null) => void
) {
  setHasServerKey(Boolean(c.has_server_key));
  const nextSeats = Array.isArray(c.seats)
    ? c.seats.filter((s) => s && typeof s.name === "string" && typeof s.agent_id === "string")
    : [];
  const nextRooms = Array.isArray(c.rooms)
    ? c.rooms.filter((r) => r && typeof r.id === "string" && typeof r.name === "string" && r.kind === "channel")
    : [];
  setSeats(nextSeats);
  setRooms(nextRooms.length > 0 ? nextRooms : [{ id: LAB_TEAM_ROOM_ID, name: "Lab Team", kind: "channel" }]);
  setSelection((prev) => {
    if (prev?.kind === "channel" && (nextRooms.some((r) => r.id === prev.id) || prev.id === LAB_TEAM_ROOM_ID)) {
      return prev;
    }
    if (prev?.kind === "dm" && nextSeats.some((s) => s.agent_id === prev.id)) return prev;
    if (nextRooms[0]) return { kind: "channel", id: nextRooms[0].id };
    if (nextSeats[0]) return { kind: "dm", id: nextSeats[0].agent_id };
    return { kind: "channel", id: LAB_TEAM_ROOM_ID };
  });
}

export default function ChatPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [gateError, setGateError] = useState("");
  const [hasServerKey, setHasServerKey] = useState(false);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [rooms, setRooms] = useState<Room[]>([{ id: LAB_TEAM_ROOM_ID, name: "Lab Team", kind: "channel" }]);
  const [selection, setSelection] = useState<Selection | null>({ kind: "channel", id: LAB_TEAM_ROOM_ID });

  const [pasteKey, setPasteKey] = useState("");
  const [pasteSaved, setPasteSaved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedRoom = useMemo(
    () => (selection?.kind === "channel" ? rooms.find((r) => r.id === selection.id) ?? rooms[0] : null),
    [rooms, selection]
  );
  const selectedSeat = useMemo(
    () => (selection?.kind === "dm" ? seats.find((s) => s.agent_id === selection.id) ?? seats[0] : null),
    [seats, selection]
  );

  const useProxy = hasServerKey;
  const headerTitle = selectedRoom?.name ?? selectedSeat?.name ?? "Chat";
  const headerSub = selectedRoom
    ? selectedRoom.description ?? `channel · ${selectedRoom.id}`
    : selectedSeat?.agent_id ?? "";

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/chat/gate", { credentials: "include" });
        const data = await res.json();
        setUnlocked(Boolean(data.unlocked));
        setHasServerKey(Boolean(data.has_server_key));
        if (data.unlocked) {
          try {
            const cfg = await fetch("/api/chat/config", { credentials: "include" });
            if (cfg.ok) {
              applyConfig(await cfg.json(), setHasServerKey, setSeats, setRooms, setSelection);
            }
          } catch {
            /* roster stays empty until retry */
          }
          if (!data.has_server_key) {
            const existing = loadPasteKey();
            if (existing) {
              setPasteKey(existing);
              setPasteSaved(true);
            }
          }
        }
      } catch {
        setGateError("Could not reach the gate.");
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setGateError("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat/gate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error === "bad_password" ? "Wrong password." : data.hint || data.error || "Unlock failed.");
        return;
      }
      setUnlocked(true);
      setPassword("");
      setHasServerKey(Boolean(data.has_server_key));
      try {
        const cfg = await fetch("/api/chat/config", { credentials: "include" });
        if (cfg.ok) {
          applyConfig(await cfg.json(), setHasServerKey, setSeats, setRooms, setSelection);
        }
      } catch {
        /* roster load soft-fail */
      }
      if (!data.has_server_key) {
        const existing = loadPasteKey();
        if (existing) {
          setPasteKey(existing);
          setPasteSaved(true);
        }
      }
    } catch {
      setGateError("Unlock failed.");
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await fetch("/api/chat/gate", { method: "DELETE", credentials: "include" });
    setUnlocked(false);
    setMessages([]);
    setStatus("");
  }

  function savePaste(e: FormEvent) {
    e.preventDefault();
    const trimmed = pasteKey.trim();
    if (!trimmed) {
      setStatus("Paste an API key first.");
      return;
    }
    savePasteKey(trimmed);
    window.sessionStorage.removeItem(RIDER_CACHE_KEY);
    setPasteSaved(true);
    setStatus("Key saved for this browser session.");
  }

  const ensureClientRider = useCallback(async (): Promise<{ token: string; apiKey: string }> => {
    const apiKey = loadPasteKey();
    if (!apiKey) throw new Error("Paste your API key first.");
    const cached = loadRiderCache();
    if (cached && cached.expires_at - Date.now() > RIDER_REFRESH_BUFFER_MS) {
      return { token: cached.token, apiKey };
    }
    const res = await fetch("/api/rider/issue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ level: "L1", scopes: ["*"] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not issue rider.");
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 900;
    saveRiderCache({ token: data.rider, expires_at: Date.now() + expiresIn * 1000 });
    return { token: data.rider, apiKey };
  }, []);

  const loadThread = useCallback(async () => {
    if (!selection) return;
    try {
      let res: Response;
      if (selection.kind === "channel") {
        if (useProxy) {
          res = await fetch(`/api/chat/channel/${selection.id}`, { credentials: "include" });
        } else {
          if (!pasteSaved && !loadPasteKey()) return;
          res = await fetch(`/api/channels/${selection.id}/messages?limit=100`);
        }
      } else if (useProxy) {
        res = await fetch(`/api/chat/dm/${selection.id}`, { credentials: "include" });
      } else {
        if (!pasteSaved && !loadPasteKey()) return;
        const { token } = await ensureClientRider();
        res = await fetch(`/api/dm/${selection.id}`, {
          headers: { "X-Agent-Rider": token },
        });
      }
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "no_server_key") {
          setHasServerKey(false);
          setStatus(data.hint || "Server key missing.");
          return;
        }
        throw new Error(data.error || "Could not load thread.");
      }
      let rows: ChatMessage[] = [];
      if (Array.isArray(data.messages)) {
        rows = data.messages.map((m: Record<string, unknown>) => ({
          id: String(m.id),
          from_agent_id: String(m.from_agent_id ?? m.agent_id ?? ""),
          content: String(m.content ?? ""),
          created_at: String(m.created_at ?? ""),
          read: Boolean(m.read),
          channel_id: typeof m.channel_id === "string" ? m.channel_id : undefined,
        }));
        // Public channel GET is newest-first; normalize to oldest-first for the UI.
        if (selection.kind === "channel" && !useProxy) {
          rows = [...rows].reverse();
        }
      }
      setMessages(rows);
      if (typeof data.self_agent_id === "string") setSelfId(data.self_agent_id);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not load thread.");
    }
  }, [selection, useProxy, pasteSaved, ensureClientRider]);

  useEffect(() => {
    if (!unlocked) return;
    if (!useProxy && !pasteSaved && !loadPasteKey() && selection?.kind === "dm") return;
    void loadThread();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void loadThread(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [unlocked, selection, useProxy, pasteSaved, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !selection) return;
    setBusy(true);
    setStatus("Sending…");
    try {
      let res: Response;
      if (selection.kind === "channel") {
        if (useProxy) {
          res = await fetch(`/api/chat/channel/${selection.id}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
        } else {
          const { token } = await ensureClientRider();
          res = await fetch(`/api/channels/${selection.id}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Rider": token,
            },
            body: JSON.stringify({ content }),
          });
        }
      } else if (useProxy) {
        res = await fetch("/api/chat/dm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to_agent_id: selection.id, content }),
        });
      } else {
        const { token } = await ensureClientRider();
        res = await fetch("/api/dm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Rider": token,
          },
          body: JSON.stringify({ to_agent_id: selection.id, content }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setDraft("");
      setStatus("");
      if (data.message) {
        const m = data.message as Record<string, unknown>;
        setMessages((prev) => [
          ...prev,
          {
            id: String(m.id),
            from_agent_id: String(m.from_agent_id ?? m.agent_id ?? selfId ?? ""),
            content: String(m.content ?? content),
            created_at: String(m.created_at ?? new Date().toISOString()),
          },
        ]);
      } else {
        await loadThread();
      }
      if (typeof data.self_agent_id === "string") setSelfId(data.self_agent_id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  const shell: CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg)",
    color: "var(--white)",
  };

  if (checking) {
    return (
      <main style={{ ...shell, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  if (!unlocked) {
    return (
      <main style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form
          onSubmit={unlock}
          style={{
            width: "100%",
            maxWidth: 380,
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 12,
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <RiderMark size={28} />
            <strong style={{ fontFamily: "var(--font-display)" }}>
              Host <span style={{ color: "var(--gold)" }}>Chat</span>
            </strong>
          </div>
          <label style={{ fontSize: 14, color: "var(--muted)" }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>
          {gateError ? <p style={{ color: "#f87171", margin: 0, fontSize: 14 }}>{gateError}</p> : null}
          <button type="submit" disabled={busy || !password} style={primaryBtn}>
            Unlock
          </button>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            <a
              href="https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/OPERATOR_JOIN.md"
              style={{ color: "var(--gold)" }}
            >
              How to join
            </a>
          </p>
        </form>
      </main>
    );
  }

  const needPaste = !useProxy && !pasteSaved;

  return (
    <main style={shell}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--panel-line)",
          background: "rgba(15,28,46,0.92)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setRosterOpen((o) => !o)}
          style={{ ...ghostBtn, display: "none" }}
          className="chat-menu-btn"
          aria-label="Team"
        >
          Team
        </button>
        <RiderMark size={24} />
        <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>
          Host <span style={{ color: "var(--gold)" }}>Chat</span>
        </strong>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "none" }} className="chat-self">
            {selfId ? shortId(selfId) : ""}
          </span>
          <a
            href="https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/OPERATOR_JOIN.md"
            style={{ fontSize: 13, color: "var(--gold)" }}
          >
            How to join
          </a>
          <button type="button" onClick={() => void lock()} style={ghostBtn}>
            Lock
          </button>
        </span>
      </header>

      {needPaste ? (
        <form
          onSubmit={savePaste}
          style={{
            margin: 16,
            padding: 16,
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 520,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
            Server has no HOST_CHAT_API_KEY. Paste your Host API key once for this browser session (kept in memory
            only — set the Fly secret for production). Channel rooms still load read-only without a key; paste to post.
          </p>
          <label style={{ fontSize: 14, color: "var(--muted)" }}>
            API key
            <input
              type="password"
              value={pasteKey}
              onChange={(e) => setPasteKey(e.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </label>
          <button type="submit" style={primaryBtn}>
            Save for session
          </button>
        </form>
      ) : null}

      <div className="chat-layout" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside
          className={`chat-roster ${rosterOpen ? "open" : ""}`}
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: "1px solid var(--panel-line)",
            background: "rgba(15,28,46,0.75)",
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", letterSpacing: 0.04 }}>
            Rooms
          </div>
          {rooms.map((room) => {
            const active = selection?.kind === "channel" && selection.id === room.id;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => {
                  setSelection({ kind: "channel", id: room.id });
                  setRosterOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  background: active ? "rgba(196,163,90,0.16)" : "transparent",
                  color: active ? "var(--gold)" : "var(--white)",
                  borderLeft: active ? "3px solid var(--gold)" : "3px solid transparent",
                  fontSize: 14,
                }}
              >
                <div style={{ fontWeight: 600 }}># {room.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{room.id}</div>
              </button>
            );
          })}

          <div style={{ padding: "12px 14px 8px", fontSize: 12, color: "var(--muted)", letterSpacing: 0.04 }}>
            DMs
          </div>
          {seats.map((seat) => {
            const active = selection?.kind === "dm" && selection.id === seat.agent_id;
            return (
              <button
                key={seat.agent_id}
                type="button"
                onClick={() => {
                  setSelection({ kind: "dm", id: seat.agent_id });
                  setRosterOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  background: active ? "rgba(196,163,90,0.16)" : "transparent",
                  color: active ? "var(--gold)" : "var(--white)",
                  borderLeft: active ? "3px solid var(--gold)" : "3px solid transparent",
                  fontSize: 14,
                }}
              >
                <div style={{ fontWeight: 600 }}>{seat.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                  {shortId(seat.agent_id)}
                </div>
              </button>
            );
          })}
        </aside>

        <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--panel-line)",
              fontSize: 14,
            }}
          >
            <strong>{headerTitle}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {headerSub}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 14, margin: "auto" }}>
                {selection?.kind === "channel"
                  ? "No messages yet. Whole-lab room — every roster seat is notified on post (Odin included). Agents: get_notifications or get_channel_messages."
                  : "No messages yet."}
              </p>
            ) : (
              messages.map((m) => {
                const mine = selfId ? m.from_agent_id === selfId : false;
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: mine ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      background: mine ? "rgba(196,163,90,0.18)" : "var(--panel)",
                      border: "1px solid var(--panel-line)",
                      borderRadius: 10,
                      padding: "8px 12px",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                      {shortId(m.from_agent_id)} · {formatTime(m.created_at)}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14 }}>{m.content}</div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {status ? (
            <p
              style={{
                margin: "0 16px 8px",
                fontSize: 13,
                color:
                  status.includes("fail") ||
                  status.includes("error") ||
                  status.includes("Could") ||
                  status.includes("Wrong") ||
                  status.includes("Paste")
                    ? "#f87171"
                    : "var(--muted)",
              }}
            >
              {status}
            </p>
          ) : null}

          <form
            onSubmit={send}
            style={{
              display: "flex",
              gap: 8,
              padding: 12,
              borderTop: "1px solid var(--panel-line)",
              background: "rgba(15,28,46,0.92)",
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={selection?.kind === "channel" ? "Message #Lab Team…" : "Message…"}
              disabled={(needPaste && selection?.kind === "dm") || busy}
              style={{ ...inputStyle, marginTop: 0, flex: 1 }}
            />
            <button
              type="submit"
              disabled={(needPaste && selection?.kind !== "channel") || busy || !draft.trim() || (needPaste && selection?.kind === "channel")}
              style={primaryBtn}
            >
              Send
            </button>
          </form>
        </section>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .chat-menu-btn { display: inline-flex !important; }
          .chat-roster {
            position: fixed !important;
            left: 0; top: 52px; bottom: 0;
            z-index: 20;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            width: min(80vw, 260px) !important;
            box-shadow: 4px 0 24px rgba(0,0,0,0.4);
          }
          .chat-roster.open { transform: translateX(0); }
          .chat-self { display: none !important; }
        }
      `}</style>
    </main>
  );
}

function formatTime(iso: string) {
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

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--panel-line)",
  background: "#0a1522",
  color: "var(--white)",
  fontSize: 15,
};

const primaryBtn: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid var(--gold)",
  background: "rgba(196,163,90,0.2)",
  color: "var(--gold)",
  fontWeight: 600,
  fontSize: 14,
};

const ghostBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--panel-line)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 13,
};
