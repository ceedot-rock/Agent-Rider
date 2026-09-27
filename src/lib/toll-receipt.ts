/**
 * Tollkeeper signed receipts — typed wrapper.
 * Pure logic lives in toll-receipt-core.mjs (selftest-importable, node:crypto).
 * Production signing key: the existing RIDER_PRIVATE_KEY / RIDER_PUBLIC_KEY
 * ES256 pair (same lab key as rider.ts). kid is the RFC 7638 JWK thumbprint.
 */

import type { KeyObject } from "node:crypto";
import {
  TollReceiptError as TollReceiptErrorJs,
  canonicalJson as canonicalJsonJs,
  tollSignerKid as tollSignerKidJs,
  signTollPayload as signTollPayloadJs,
  verifyTollEnvelope as verifyTollEnvelopeJs,
  verifyTollEnvelopeOk as verifyTollEnvelopeOkJs,
  tollEnvelopeId as tollEnvelopeIdJs,
  devTollKeypair as devTollKeypairJs,
  jwksForTest as jwksForTestJs,
  labJwks as labJwksJs,
} from "./toll-receipt-core.mjs";

export const TollReceiptError = TollReceiptErrorJs as new (
  message?: string
) => Error;

export interface TollEnvelope {
  payload: Record<string, unknown>;
  sig: string;
  kid: string;
  alg: "ES256";
}

export type JwksLike =
  | { keys?: Array<Record<string, unknown>> }
  | Record<string, Record<string, unknown>>;

export interface SignOpts {
  privateKey?: KeyObject;
  kid?: string;
}

export function canonicalJson(payload: unknown): string {
  return canonicalJsonJs(payload) as string;
}

export function tollSignerKid(publicKeyPem?: string): string {
  return tollSignerKidJs(publicKeyPem) as string;
}

export function signTollPayload(
  payload: Record<string, unknown>,
  opts?: SignOpts
): TollEnvelope {
  return signTollPayloadJs(payload, opts) as TollEnvelope;
}

export function verifyTollEnvelope(
  envelope: unknown,
  jwks: JwksLike
): Record<string, unknown> {
  return verifyTollEnvelopeJs(envelope, jwks) as Record<string, unknown>;
}

export function verifyTollEnvelopeOk(
  envelope: unknown,
  jwks: JwksLike
): [true, Record<string, unknown>] | [false, string] {
  return verifyTollEnvelopeOkJs(envelope, jwks) as
    | [true, Record<string, unknown>]
    | [false, string];
}

export function tollEnvelopeId(envelope: TollEnvelope): string {
  return tollEnvelopeIdJs(envelope) as string;
}

export function devTollKeypair(kid = "dev-toll-1"): {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
} {
  return devTollKeypairJs(kid) as {
    privateKey: KeyObject;
    publicKey: KeyObject;
    kid: string;
  };
}

export function jwksForTest(
  publicKey: KeyObject,
  kid: string
): Record<string, Record<string, unknown>> {
  return jwksForTestJs(publicKey, kid) as Record<
    string,
    Record<string, unknown>
  >;
}

/** Lab JWKS for verifying lab-sealed envelopes (from RIDER_PUBLIC_KEY). */
export function labJwks(): { keys: Array<Record<string, unknown>> } {
  return labJwksJs() as { keys: Array<Record<string, unknown>> };
}
