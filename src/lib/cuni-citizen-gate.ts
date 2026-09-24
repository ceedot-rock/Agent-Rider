/**
 * CuNi citizen receipt gate — Translate → Fund → Execute.
 *
 * Validates citizen receipt PASS fields on contract / settle / job-accept paths:
 *   - source_hash present (non-empty string; sourceHash accepted as alias)
 *   - exactness.passed === true
 *
 * Modes:
 *   1. Validate-when-present (always): if a receipt object is on the request,
 *      refuse unless PASS fields hold.
 *   2. Strict (optional): CUNI_CITIZEN_RECEIPT_REQUIRED=true → refuse when
 *      receipt is missing. Default OFF.
 *
 * Honesty: local shape gate only. Does NOT call CuNi Studio.
 * Studio → Rider HTTP receive is separate (POST /api/v0/citizen-receipts).
 * Rider → Studio outbound verify remains PARKED.
 * Fund path for hops = Rider settle / XPay (never PCC as money layer).
 * Never log or embed ar_ values.
 */

export const CUNI_CITIZEN_RECEIPT_REQUIRED_ENV = "CUNI_CITIZEN_RECEIPT_REQUIRED" as const;

export const CUNI_CITIZEN_GATE_DOCS =
  "https://github.com/ceedot-rock/Agent-Rider/blob/main/docs/CUNI_CITIZEN_GATE.md" as const;

/** PASS receipt after shape validation. */
export type CitizenReceiptPass = {
  source_hash: string;
  exactness: { passed: true; checkedAt?: string; targets?: string[]; stdoutMatch?: boolean };
};

export type CitizenGateFailBody = {
  error: "citizen_receipt_required" | "citizen_receipt_invalid";
  message: string;
  missing?: string[];
  docs_url: typeof CUNI_CITIZEN_GATE_DOCS;
  /** Local shape only — not a live Studio call. */
  studio: "not_called";
  gate: {
    name: typeof CUNI_CITIZEN_RECEIPT_REQUIRED_ENV;
    required: boolean;
    note: string;
  };
};

export type CitizenGateResult =
  | { ok: true; receipt: CitizenReceiptPass | null; required: boolean }
  | { ok: false; status: 400; body: CitizenGateFailBody };

/** True only when env explicitly sets CUNI_CITIZEN_RECEIPT_REQUIRED=true. Default false. */
export function isCitizenReceiptRequired(): boolean {
  return process.env.CUNI_CITIZEN_RECEIPT_REQUIRED === "true";
}

/**
 * Pull a receipt candidate from a JSON body.
 * Prefers citizen_receipt / citizenReceipt / receipt; else top-level publish-meta
 * shape (sourceHash|source_hash + exactness) for contract register compatibility.
 */
export function extractCitizenReceiptCandidate(body: unknown): unknown | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;

  for (const key of ["citizen_receipt", "citizenReceipt", "receipt"] as const) {
    if (obj[key] != null && typeof obj[key] === "object") return obj[key];
  }

  const meta =
    obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : null;
  if (meta && hasReceiptFieldHints(meta)) return meta;
  if (hasReceiptFieldHints(obj)) return obj;

  return undefined;
}

function hasReceiptFieldHints(obj: Record<string, unknown>): boolean {
  const hasHash =
    typeof obj.source_hash === "string" || typeof obj.sourceHash === "string";
  return hasHash || (obj.exactness != null && typeof obj.exactness === "object");
}

/**
 * Shape validation for a citizen receipt (or publish-meta equivalent).
 * Requires non-empty source_hash|sourceHash and exactness.passed === true.
 */
export function validateCitizenReceiptShape(
  receipt: unknown
):
  | { ok: true; receipt: CitizenReceiptPass }
  | { ok: false; error: string; missing: string[] } {
  if (!receipt || typeof receipt !== "object") {
    return { ok: false, error: "citizen receipt must be an object", missing: ["source_hash", "exactness.passed"] };
  }
  const r = receipt as Record<string, unknown>;
  const missing: string[] = [];

  const hashRaw =
    typeof r.source_hash === "string"
      ? r.source_hash
      : typeof r.sourceHash === "string"
        ? r.sourceHash
        : null;
  const source_hash = hashRaw && hashRaw.trim().length > 0 ? hashRaw.trim() : null;
  if (!source_hash) missing.push("source_hash");

  const exact =
    r.exactness && typeof r.exactness === "object"
      ? (r.exactness as Record<string, unknown>)
      : null;
  if (!exact || exact.passed !== true) missing.push("exactness.passed");

  if (missing.length > 0 || !source_hash || !exact) {
    return {
      ok: false,
      error: "citizen receipt PASS requires source_hash and exactness.passed === true",
      missing: missing.length ? missing : ["source_hash", "exactness.passed"],
    };
  }

  const pass: CitizenReceiptPass = {
    source_hash,
    exactness: {
      passed: true,
      checkedAt: typeof exact.checkedAt === "string" ? exact.checkedAt : undefined,
      targets: Array.isArray(exact.targets) ? (exact.targets as string[]) : undefined,
      stdoutMatch: typeof exact.stdoutMatch === "boolean" ? exact.stdoutMatch : undefined,
    },
  };
  return { ok: true, receipt: pass };
}

function failBody(
  error: CitizenGateFailBody["error"],
  message: string,
  required: boolean,
  missing?: string[]
): CitizenGateFailBody {
  return {
    error,
    message,
    ...(missing ? { missing } : {}),
    docs_url: CUNI_CITIZEN_GATE_DOCS,
    studio: "not_called",
    gate: {
      name: CUNI_CITIZEN_RECEIPT_REQUIRED_ENV,
      required,
      note: required
        ? "Strict mode ON — receipt required; fail-closed."
        : "Validate-when-present — receipt optional unless this env is true.",
    },
  };
}

/**
 * Shared Translate→Fund→Execute gate for contract / settle / job-accept bodies.
 */
export function checkCitizenReceiptGate(body: unknown): CitizenGateResult {
  const required = isCitizenReceiptRequired();
  const candidate = extractCitizenReceiptCandidate(body);

  if (candidate === undefined) {
    if (required) {
      return {
        ok: false,
        status: 400,
        body: failBody(
          "citizen_receipt_required",
          "CUNI_CITIZEN_RECEIPT_REQUIRED: provide citizen_receipt with source_hash and exactness.passed === true",
          true,
          ["citizen_receipt"]
        ),
      };
    }
    return { ok: true, receipt: null, required: false };
  }

  const validated = validateCitizenReceiptShape(candidate);
  // Use === false so Next/tsc narrows the discriminant (strict:false weakens !ok).
  if (validated.ok === false) {
    return {
      ok: false,
      status: 400,
      body: failBody(
        "citizen_receipt_invalid",
        validated.error,
        required,
        validated.missing
      ),
    };
  }

  return { ok: true, receipt: validated.receipt, required };
}

export function isCitizenGateOk(
  result: CitizenGateResult
): result is { ok: true; receipt: CitizenReceiptPass | null; required: boolean } {
  return result.ok === true;
}
