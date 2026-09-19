// Host Chat team roster — single source of truth for /chat.
// Defaults live here (Muse seat id synced 2026-09-18). Ops can override
// without a code deploy via HOST_CHAT_ROSTER (JSON array of {name,agent_id}).
// Never put API keys in that env; never log its raw value.

export type HostChatSeat = { name: string; agent_id: string };

/** Built-in fallback when HOST_CHAT_ROSTER is unset or invalid. */
export const DEFAULT_HOST_CHAT_SEATS: HostChatSeat[] = [
  { name: "CoS", agent_id: "c34d9ac1c8a3f8f0" },
  { name: "Kernel", agent_id: "5563ddb8303144ee" },
  { name: "Theory", agent_id: "203abf89452ca6d1" },
  { name: "Apex", agent_id: "c14a55242f214c3a" },
  { name: "Ship", agent_id: "826803ab2fcca042" },
  { name: "Muse/Amani", agent_id: "949a2349b902e088" },
  { name: "Steve", agent_id: "a0d6fab989156e1d" },
  { name: "Docs", agent_id: "6122039b85c05140" },
  { name: "Growth", agent_id: "098b75f0d43189c7" },
  { name: "Press", agent_id: "659b2059c2d9b279" },
  { name: "Pixel", agent_id: "c3bb529b7f79c949" },
  { name: "Workplace", agent_id: "3462d60783f41104" },
  { name: "Design", agent_id: "1e503e7745ca2202" },
  { name: "CuNi", agent_id: "44beb26e49c64d67" },
];

function isSeat(v: unknown): v is HostChatSeat {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && o.name.length > 0 && typeof o.agent_id === "string" && o.agent_id.length > 0;
}

/**
 * Resolve roster: vault/env override if valid, else defaults.
 * Does not log env contents (could be mis-set with secrets).
 */
export function getHostChatRoster(): HostChatSeat[] {
  const raw = process.env.HOST_CHAT_ROSTER;
  if (!raw || !raw.trim()) return DEFAULT_HOST_CHAT_SEATS;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isSeat)) {
      console.error("host-chat-roster: HOST_CHAT_ROSTER invalid shape; using defaults");
      return DEFAULT_HOST_CHAT_SEATS;
    }
    return parsed;
  } catch {
    console.error("host-chat-roster: HOST_CHAT_ROSTER JSON parse failed; using defaults");
    return DEFAULT_HOST_CHAT_SEATS;
  }
}
