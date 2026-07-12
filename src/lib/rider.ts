import { SignJWT, jwtVerify, importPKCS8, importSPKI, type CryptoKey } from "jose";

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

function getSigningKey(): Promise<CryptoKey> {
  if (!signingKeyPromise) signingKeyPromise = importPKCS8(privatePem!, "ES256");
  return signingKeyPromise;
}

function getVerifyKey(): Promise<CryptoKey> {
  if (!verifyKeyPromise) verifyKeyPromise = importSPKI(publicPem!, "ES256");
  return verifyKeyPromise;
}

export async function issueRider(
  payload: Omit<RiderPayload, "jti">,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<{ token: string; jti: string; expires_in: number }> {
  const jti = crypto.randomUUID();
  const key = await getSigningKey();
  const token = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
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

// --- revocation (in-memory demo stub — swap for Upstash/KV before real use;
// resets on every cold start and isn't shared across serverless instances) --
const revoked = new Set<string>();
export function isRevoked(jti: string): boolean {
  return revoked.has(jti);
}
export function revoke(jti: string) {
  revoked.add(jti);
}

// --- shared gate check, used by every demo route -------------------------
export type GateResult =
  | { ok: true; rider: RiderPayload }
  | { ok: false; status: number; body: any };

// tsconfig here runs with strict: false, which disables TypeScript's control-flow
// narrowing on awaited discriminated unions (`if (!gate.ok)` doesn't narrow the
// type). An explicit type predicate sidesteps that instead of relying on it.
export function isGateOk(result: GateResult): result is { ok: true; rider: RiderPayload } {
  return result.ok === true;
}

export async function checkGate(
  request: Request,
  minLevel: ClearanceLevel,
  scope?: string
): Promise<GateResult> {
  const token = request.headers.get("x-agent-rider");
  if (!token) return { ok: false, status: 401, body: { error: "missing_rider" } };

  const result = await verifyRider(token);
  if (!result.valid || !result.rider) {
    return { ok: false, status: 401, body: { error: "invalid_rider", reason: result.reason } };
  }

  const rider = result.rider;

  if ((minLevel === "L3" || minLevel === "L4") && isRevoked(rider.jti)) {
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
