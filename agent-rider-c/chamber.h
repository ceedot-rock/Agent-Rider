#ifndef AGENT_RIDER_CHAMBER_H
#define AGENT_RIDER_CHAMBER_H

#include "cuni.h"

/* Chamber hop-gate over exact-text CuNi messages.
 * Returns admit | reject.* codes as stable strings. */

typedef struct {
  const char **allow_agents; /* NULL-terminated; NULL = any */
  const char **seen_hashes;  /* NULL-terminated replay set */
  size_t seen_n;
} chamber_policy;

/* Evaluate a ScanChunk wire. out_code receives e.g. "admit" or "reject.extra". */
cuni_err chamber_admit_scan(const char *text, const chamber_policy *pol, char *out_code, size_t cap);

/* Append-only reject log (path); returns 0 on success. */
int chamber_log_reject(const char *path, const char *code, const char *preview);

#endif
