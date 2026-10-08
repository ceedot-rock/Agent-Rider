/**
 * Tollkeeper signed receipts — typed wrapper.
 * Pure logic lives in toll-receipt-core.mjs (selftest-importable, node:crypto).
 *
 * Production signing key: the DEDICATED TOLL_SIGNING_KEY ES256 pair — never
 * the Rider identity key. kid is the RFC 7638 JWK thumbprint. The JWKS
 * carries the Rider identity key (backwards compat), the current toll
 * signer, previous toll signers in their grace period, and a "revoked" list;
 * verifiers must reject unknown_kid and revoked_kid. See ROTATION.md.
 */

import type { KeyObject } from "node:crypto";
import {
  TollReceiptError as TollReceiptErrorJs,
  canonicalJson as canonicalJsonJs,
  tollSignerKid as tollSignerKidJs,
  tollPublicJwk as tollPublicJwkJs,
  riderPublicJwk as riderPublicJwkJs,
  previousTollPublicJwks as previousTollPublicJwksJs,
  parseRevokedKids as parseRevokedKidsJs,
  tollJwks as tollJwksJs,
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

export interface TollPublicJwk extends Record<string, unknown> {
  kid: string;
  alg: string;
  use: string;
}

/** Public JWK of the dedicated toll signer (derived from TOLL_SIGNING_KEY). */
export function tollPublicJwk(): TollPublicJwk {
  return tollPublicJwkJs() as TollPublicJwk;
}

/** Public JWK of the Rider identity key (backwards compat). */
export function riderPublicJwk(): TollPublicJwk {
  return riderPublicJwkJs() as TollPublicJwk;
}

/** Previous toll-signer public keys still in their rotation grace period. */
export function previousTollPublicJwks(raw?: string): TollPublicJwk[] {
  return previousTollPublicJwksJs(raw) as TollPublicJwk[];
}

export interface RevokedKid {
  kid: string;
  revoked_at: string;
}

/** Parsed TOLL_REVOKED_KIDS list. */
export function parseRevokedKids(raw?: string): RevokedKid[] {
  return parseRevokedKidsJs(raw) as RevokedKid[];
}

export interface TollJwks {
  keys: TollPublicJwk[];
  revoked: RevokedKid[];
}

/** JWKS for toll-signer verification: current + previous keys, revoked list. */
export function tollJwks(): TollJwks {
  return tollJwksJs() as TollJwks;
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

/** Lab JWKS for verifying lab-sealed envelopes: Rider key + toll signer(s) + revoked list. */
export function labJwks(): TollJwks {
  return labJwksJs() as TollJwks;
}
