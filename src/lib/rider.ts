import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK, calculateJwkThumbprint, type CryptoKey, type JWK } from "jose";
import { getDB } from "@/lib/db";

export type ClearanceLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface RiderPayload {
  agent_id: string;
  operator_id: string;
  level: ClearanceLevel;
  scopes: string[];
  reputation_score?: number;
  layer_from?: "agent" | "human";
  layer_to?: "agent" | "human";
  jti: string;
}

const ISSUER = "agentrider.dev";
const DEFAULT_TTL_SECONDS = 15 * 60;

const privatePem = process.env.RIDER_PRIVATE_KEY;
const publicPem = process.env.RIDER_PUBLIC_KEY;

if (!privatePem || !publicPem) {
  throw new Error(
    "Missing RIDER_PRIVATE_KEY / RIDER_PUBLIC_KEY environment variables. Generate an ES256 keypair and set both in Vercel project settings (Production) or your local .env file."
  );
}

let signingKeyPromise: Promise<CryptoKey> | null = null;
let verifyKeyPromise: Promise<CryptoKey> | null = null;
let publicJwkPromise: Promise<JWK & { kid: string }> | null = null;

function getSigningKey(): Promise<CryptoKey> {
  if (!signingKeyPromise) signingKeyPromise = importPKCS8(privatePem!, "ES256");
  return signingKeyPromise;
}

function getVerifyKey(): Promise<CryptoKey> {
  if (!verifyKeyPromise) verifyKeyPromise = importSPKI(publicPem!, "ES256");
  return verifyKeyPromise;
}

// The public half of the signing key, as a JWK — this is what makes "any
// gate verifies locally, no round trip to us" actually true for a third
// party instead of just for our own /api/rider/verify. `kid` is an RFC 7638
// thumbprint of the key itself, so it stays stable across deploys and lets
// a future key rotation publish both old and new keys without breaking
// tokens already in flight.
async function getPublicJwk(): Promise<JWK & { kid: string }> {
  if (!publicJwkPromise) {
    publicJwkPromise = (async () => {
      const key = await getVerifyKey();
      const jwk = await exportJWK(key);
      const kid = await calculateJwkThumbprint(jwk);
      return { ...jwk, kid, alg: "ES256", use: "sig" };
    })();
  }
  return publicJwkPromise;
}

export async function getJwks(): Promise<{ keys: (JWK & { kid: string })[] }> {
  return { keys: [await getPublicJwk()] };
}

export async function issueRider(
  payload: Omit<RiderPayload, "jti">,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<{ token: string; jti: string; expires_in: number }> {
  const jti = crypto.randomUUID();
  const [key, jwk] = await Promise.all([getSigningKey(), getPublicJwk()]);
  const token = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: jwk.kid })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
  return { token, jti, expires_in: ttlSeconds };
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  rider?: RiderPayload;
}

export async function verifyRider(token: string): Promise<VerifyResult> {
  try {
    const key = await getVerifyKey();
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    return { valid: true, rider: payload as unknown as RiderPayload };
  } catch (err: any) {
    return { valid: false, reason: err.code ?? "invalid_token" };
  }
}

const LEVEL_RANK: Record<ClearanceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

export function meetsClearance(rider: RiderPayload, minLevel: ClearanceLevel): boolean {
  return LEVEL_RANK[rider.level] >= LEVEL_RANK[minLevel];
}

export function hasScope(rider: RiderPayload, required: string): boolean {
  return rider.scopes.some(
    (s) => s === required || (s.endsWith("*") && required.startsWith(s.slice(0, -1)))
  );
}

// --- revocation (Postgres-backed — see supabase/schema.sql `revoked_tokens`;
// durable and shared across serverless instances, unlike the in-memory Set
// this replaced) ------------------------------------------------------------
export async function isRevoked(jti: string): Promise<boolean> {
  const { data } = await getDB().from("revoked_tokens").select("jti").eq("jti", jti).single();
  return data !== null;
}

export async function revoke(jti: string, agentId?: string, reason?: string): Promise<void> {
  await getDB()
    .from("revoked_tokens")
    .upsert({ jti, agent_id: agentId ?? null, reason: reason ?? null });
}

// --- shared gate check, used by every demo route -------------------------
export type GateResult =
  | { ok: true; rider: RiderPayload }
  | { ok: false; status: number; body: any; headers?: Record<string, string> };

// tsconfig here runs with strict: false, which disables TypeScript's control-flow
// narrowing on awaited discriminated unions (`if (!gate.ok)` doesn't narrow the
// type). An explicit type predicate sidesteps that instead of relying on it.
export function isGateOk(result: GateResult): result is { ok: true; rider: RiderPayload } {
  return result.ok === true;
}

const ISSUE_URL = "https://agentrider.vercel.app/api/rider/issue";
const DOCS_URL = "https://agentrider.vercel.app/docs";

// A 401 for a missing/invalid rider is self-describing, the same way OAuth's
// `WWW-Authenticate: Bearer` challenge works — any agent (or agent framework)
// that hits this wall can discover where to get a rider without prior
// knowledge, from the response itself.
function missingRiderChallenge(reason: "missing_rider" | "invalid_rider", extra?: object): GateResult {
  return {
    ok: false,
    status: 401,
    body: { error: reason, issue_url: ISSUE_URL, docs_url: DOCS_URL, ...extra },
    headers: {
      "WWW-Authenticate": `Rider realm="agentrider.dev", issue_uri="${ISSUE_URL}", docs_uri="${DOCS_URL}"`,
    },
  };
}

// Shared by checkGate (HTTP routes, reads the X-Agent-Rider header) and the
// MCP server (src/app/api/mcp/route.ts), which has no request/header object —
// each gated tool call carries its rider token as a plain string argument
// instead.
export async function checkGateForToken(
  token: string | null,
  minLevel: ClearanceLevel,
  scope?: string
): Promise<GateResult> {
  if (!token) return missingRiderChallenge("missing_rider");

  const result = await verifyRider(token);
  if (!result.valid || !result.rider) {
    return missingRiderChallenge("invalid_rider", { reason: result.reason });
  }

  const rider = result.rider;

  if ((minLevel === "L3" || minLevel === "L4") && (await isRevoked(rider.jti))) {
    return { ok: false, status: 403, body: { error: "revoked" } };
  }

  if (!meetsClearance(rider, minLevel)) {
    return {
      ok: false,
      status: 403,
      body: { error: "insufficient_clearance", have: rider.level, need: minLevel },
    };
  }

  if (scope && !hasScope(rider, scope)) {
    return { ok: false, status: 403, body: { error: "insufficient_scope", need: scope } };
  }

  return { ok: true, rider };
}

export async function checkGate(
  request: Request,
  minLevel: ClearanceLevel,
  scope?: string
): Promise<GateResult> {
  return checkGateForToken(request.headers.get("x-agent-rider"), minLevel, scope);
}
