import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const CHAT_GATE_COOKIE = "chat_gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const TOKEN_VERSION = "1";

function gateSecret(): string | null {
  const secret = process.env.CHAT_GATE_PASSWORD;
  if (!secret || secret.trim().length === 0) return null;
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function makeGateToken(): string | null {
  const secret = gateSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const payload = `${TOKEN_VERSION}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyGateToken(token: string | undefined | null): boolean {
  const secret = gateSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expStr, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `${version}.${expStr}`;
  const expected = sign(payload, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function passwordMatches(submitted: string): boolean {
  const secret = gateSecret();
  if (!secret) return false;
  try {
    const a = Buffer.from(submitted);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function gateConfigured(): boolean {
  return gateSecret() !== null;
}

export function hostApiKeyConfigured(): boolean {
  const key = process.env.HOST_CHAT_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

export function getHostApiKey(): string | null {
  const key = process.env.HOST_CHAT_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

export async function isChatUnlocked(): Promise<boolean> {
  const jar = await cookies();
  return verifyGateToken(jar.get(CHAT_GATE_COOKIE)?.value);
}

export function applyGateCookie(res: NextResponse, token: string): void {
  res.cookies.set(CHAT_GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearGateCookie(res: NextResponse): void {
  res.cookies.set(CHAT_GATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
