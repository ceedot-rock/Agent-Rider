"use client";

export const SESSION_KEY = "agentrider.session";

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

export function loadSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientSession;
    if (!parsed?.agent_id || !parsed?.api_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Omit<ClientSession, "saved_at">): ClientSession {
  const stored: ClientSession = { ...session, saved_at: Date.now() };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  return stored;
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function authHeaders(session: ClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.api_key}`,
    "X-Agent-Rider": session.rider,
  };
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
