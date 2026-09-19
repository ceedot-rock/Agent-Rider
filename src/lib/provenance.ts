/**
 * Participant provenance — where a seat came from.
 * Enum: lab | external | smoke | unknown (default).
 * Not KYC. Not a trust claim. Ops/labeling only.
 */

export const PROVENANCE_VALUES = ["lab", "external", "smoke", "unknown"] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

export function isProvenance(v: unknown): v is Provenance {
  return typeof v === "string" && (PROVENANCE_VALUES as readonly string[]).includes(v);
}

export function normalizeProvenance(v: unknown): Provenance {
  return isProvenance(v) ? v : "unknown";
}

export type ProvenanceCounts = Record<Provenance, number>;

export function emptyProvenanceCounts(): ProvenanceCounts {
  return { lab: 0, external: 0, smoke: 0, unknown: 0 };
}

/** Aggregate counts; missing/invalid → unknown. */
export function tallyProvenance(values: Array<string | null | undefined>): ProvenanceCounts {
  const counts = emptyProvenanceCounts();
  for (const v of values) {
    counts[normalizeProvenance(v)] += 1;
  }
  return counts;
}
