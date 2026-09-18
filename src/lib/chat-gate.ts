import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const GATE_COOKIE = "ar_chat_gate";
export const API_KEY_COOKIE = "ar_chat_api_key";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function gateConfigured(): boolean {
  return Boolean(process.env.CHAT_GATE_PASSWORD);
}

export function gatePasswordSet(): boolean {
  return gateConfigured();
}

export function hostApiKeyFromEnv(): string | null {
  const key = process.env.HOST_CHAT_API_KEY?.trim();
  return key ? key : null;
}

function expectedGateToken(): string {
  const password = process.env.CHAT_GATE_PASSWORD;
  if (!password) throw new Error("CHAT_GATE_PASSWORD_unset");
  return createHmac("sha256", password).update("agentrider-chat-gate-v1").digest("hex");
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.CHAT_GATE_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // still do a compare to avoid leaking length via timing of early return alone
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(a, b);
}

export function cookieBase(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return true;
  }
}

export async function isGateUnlocked(): Promise<boolean> {
  if (!gateConfigured()) return false;
  try {
    const jar = await cookies();
    const value = jar.get(GATE_COOKIE)?.value;
    if (!value) return false;
    const expected = expectedGateToken();
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function gateCookieValue(): string {
  return expectedGateToken();
}

export async function resolveHostApiKey(): Promise<string | null> {
  const fromEnv = hostApiKeyFromEnv();
  if (fromEnv) return fromEnv;
  try {
    const jar = await cookies();
    const fromCookie = jar.get(API_KEY_COOKIE)?.value?.trim();
    return fromCookie || null;
  } catch {
    return null;
  }
}

export async function sessionStatus(): Promise<{
  unlocked: boolean;
  hasHostKey: boolean;
  needsApiKey: boolean;
  gateConfigured: boolean;
}> {
  const unlocked = await isGateUnlocked();
  const envKey = Boolean(hostApiKeyFromEnv());
  let cookieKey = false;
  try {
    const jar = await cookies();
    cookieKey = Boolean(jar.get(API_KEY_COOKIE)?.value?.trim());
  } catch {
    cookieKey = false;
  }
  const hasHostKey = envKey || cookieKey;
  return {
    unlocked,
    hasHostKey,
    needsApiKey: unlocked && !hasHostKey,
    gateConfigured: gateConfigured(),
  };
}
