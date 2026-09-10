"use client";

export const SESSION_KEY = "agentrider.session";
const LEGACY_SESSION_KEY = "agentrider.start";

export interface ClientSession {
  agent_id: string;
  name: string;
  type: "agent" | "human";
  api_key: string;
  rider: string;
  credits: number;
  expires_in?: number;
  saved_at: number;
}

function parseSession(raw: string | null): ClientSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClientSession> & Record<string, unknown>;
    if (!parsed?.agent_id || !parsed?.api_key) return null;
    return {
      agent_id: String(parsed.agent_id),
      name: typeof parsed.name === "string" ? parsed.name : "",
      type: parsed.type === "human" ? "human" : "agent",
      api_key: String(parsed.api_key),
      rider: typeof parsed.rider === "string" ? parsed.rider : "",
      credits: Number(parsed.credits ?? 0),
      expires_in: typeof parsed.expires_in === "number" ? parsed.expires_in : undefined,
      saved_at: typeof parsed.saved_at === "number" ? parsed.saved_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const current = parseSession(window.localStorage.getItem(SESSION_KEY));
  if (current) return current;

  // Migrate the interim /start key used on main before this loop landed.
  const legacy = parseSession(window.localStorage.getItem(LEGACY_SESSION_KEY));
  if (!legacy) return null;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  return legacy;
}

export function saveSession(session: Omit<ClientSession, "saved_at">): ClientSession {
  const stored: ClientSession = { ...session, saved_at: Date.now() };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  return stored;
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
}

export function authHeaders(session: ClientSession): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.api_key}`,
  };
  if (session.rider) headers["X-Agent-Rider"] = session.rider;
  return headers;
}

export async function refreshRider(session: ClientSession): Promise<ClientSession> {
  const res = await fetch("/api/rider/issue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.api_key}`,
    },
    body: JSON.stringify({ level: "L1", scopes: ["*"] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not refresh rider");
  return saveSession({ ...session, rider: data.rider, expires_in: data.expires_in });
}
