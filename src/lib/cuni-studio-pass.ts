/**
 * Rider → CuNi Studio Execute verify — POST /api/pass (env-gated).
 *
 * Default OFF. Set CUNI_STUDIO_PASS_REQUIRED=true for fail-closed Execute
 * round-trip before sealed ride. Also fires when body.studio_pass===true.
 * Never softens REFUSE. Never prints ar_/JWT. PCC is compressor-only.
 *
 * Receive (POST /api/v0/citizen-receipts) stays unchanged — do not hook
 * contracts Translate ingress to re-call Studio.
 */

import {
  CUNI_STUDIO_PASS_REQUIRED_ENV as CUNI_STUDIO_PASS_REQUIRED_ENV_JS,
  CUNI_STUDIO_URL_ENV as CUNI_STUDIO_URL_ENV_JS,
  DEFAULT_CUNI_STUDIO_URL as DEFAULT_CUNI_STUDIO_URL_JS,
  CUNI_STUDIO_PASS_DOCS as CUNI_STUDIO_PASS_DOCS_JS,
  CUNI_STUDIO_PASS_TIMEOUT_MS as CUNI_STUDIO_PASS_TIMEOUT_MS_JS,
  isStudioPassRequired as isStudioPassRequiredJs,
  resolveStudioUrl as resolveStudioUrlJs,
  extractStudioPassSource as extractStudioPassSourceJs,
  shouldCallStudioPass as shouldCallStudioPassJs,
  callStudioPass as callStudioPassJs,
  verifyWithStudioPass as verifyWithStudioPassJs,
  checkStudioPassGate as checkStudioPassGateJs,
  isStudioPassGateOk as isStudioPassGateOkJs,
} from "./cuni-studio-pass.mjs";

export const CUNI_STUDIO_PASS_REQUIRED_ENV = CUNI_STUDIO_PASS_REQUIRED_ENV_JS;
export const CUNI_STUDIO_URL_ENV = CUNI_STUDIO_URL_ENV_JS;
export const DEFAULT_CUNI_STUDIO_URL = DEFAULT_CUNI_STUDIO_URL_JS;
export const CUNI_STUDIO_PASS_DOCS = CUNI_STUDIO_PASS_DOCS_JS;
export const CUNI_STUDIO_PASS_TIMEOUT_MS = CUNI_STUDIO_PASS_TIMEOUT_MS_JS;

export type StudioPassCallResult = {
  ok: boolean;
  status: number;
  verdict: string | null;
  citizen_receipt: unknown | null;
  studio: "called" | "not_called";
  error: string | null;
  body: unknown;
  exactness?: unknown;
  source_hash?: string | null;
};

export type StudioPassGateOkSkipped = {
  ok: true;
  skipped: true;
  studio: "not_called";
  required: false;
  citizen_receipt: null;
};

export type StudioPassGateOkCalled = {
  ok: true;
  skipped: false;
  studio: "called";
  required: boolean;
  citizen_receipt: unknown;
  result: StudioPassCallResult;
};

export type StudioPassGateFail = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type StudioPassGateResult =
  | StudioPassGateOkSkipped
  | StudioPassGateOkCalled
  | StudioPassGateFail;

export function isStudioPassRequired(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean {
  return isStudioPassRequiredJs(env);
}

export function resolveStudioUrl(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): string {
  return resolveStudioUrlJs(env);
}

export function extractStudioPassSource(body: unknown): string | null {
  return extractStudioPassSourceJs(body);
}

export function shouldCallStudioPass(
  body: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean {
  return shouldCallStudioPassJs(body, env);
}

export async function callStudioPass(opts: {
  source: string;
  studioUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<StudioPassCallResult> {
  return callStudioPassJs(opts) as Promise<StudioPassCallResult>;
}

export async function verifyWithStudioPass(
  source: string,
  opts?: {
    studioUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<StudioPassCallResult> {
  return verifyWithStudioPassJs(source, opts) as Promise<StudioPassCallResult>;
}

export async function checkStudioPassGate(
  body: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<StudioPassGateResult> {
  return checkStudioPassGateJs(body, env, opts) as Promise<StudioPassGateResult>;
}

export function isStudioPassGateOk(
  result: StudioPassGateResult
): result is StudioPassGateOkSkipped | StudioPassGateOkCalled {
  return isStudioPassGateOkJs(result);
}
