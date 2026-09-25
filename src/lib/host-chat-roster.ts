// Host Chat team roster — single source of truth for /chat.
// Defaults live here (synced to /workspace/.secrets/rider-team/REGISTRY.md).
// Ops can override without a code deploy via HOST_CHAT_ROSTER
// (JSON array of {name,agent_id}). Never put API keys in that env; never log its raw value.

export type HostChatSeat = { name: string; agent_id: string };

export type HostChatRoom = {
  id: string;
  name: string;
  kind: "channel";
  description?: string;
};

/** Built-in fallback when HOST_CHAT_ROSTER is unset or invalid. */
export const DEFAULT_HOST_CHAT_SEATS: HostChatSeat[] = [
  { name: "CoS", agent_id: "c34d9ac1c8a3f8f0" },
  { name: "Corey", agent_id: "2e69df930a3beaff" },
  { name: "Grok", agent_id: "c83275891efd76a0" },
  { name: "Kernel", agent_id: "5563ddb8303144ee" },
  { name: "Amani", agent_id: "fbe0912fa4ddaa27" },
  { name: "Odin", agent_id: "443fa43c2917f5d5" },
  { name: "agent^rider", agent_id: "6e1031b9adb12231" },
  { name: "Apex", agent_id: "c14a55242f214c3a" },
  { name: "CuNi", agent_id: "44beb26e49c64d67" },
  { name: "Design", agent_id: "1e503e7745ca2202" },
  { name: "Docs", agent_id: "6122039b85c05140" },
  { name: "Growth", agent_id: "098b75f0d43189c7" },
  { name: "Meta", agent_id: "935da5959f787cc8" },
  { name: "Pixel", agent_id: "c3bb529b7f79c949" },
  { name: "Press", agent_id: "659b2059c2d9b279" },
  { name: "Ship", agent_id: "826803ab2fcca042" },
  { name: "Steve", agent_id: "a0d6fab989156e1d" },
  { name: "Theory", agent_id: "203abf89452ca6d1" },
  { name: "Workplace", agent_id: "3462d60783f41104" },
  { name: "agent-rider/Labs", agent_id: "7e3e95752151512f" },
  { name: "charggri", agent_id: "6b2343438df3111c" },
  { name: "lunk", agent_id: "7b530567d7120a2f" },
];

/** Whole-team room pinned at the top of Host Chat (channel-backed). */
export const DEFAULT_HOST_CHAT_ROOMS: HostChatRoom[] = [
  {
    id: "lab-team",
    name: "Lab Team",
    kind: "channel",
    description: "Whole-lab room — Corey + all registered lab seats",
  },
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

export function getHostChatRooms(): HostChatRoom[] {
  return DEFAULT_HOST_CHAT_ROOMS;
}
