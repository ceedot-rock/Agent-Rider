/* Exact-text CuNi wire for Agent-Rider SiteScan hops.
 * Format mirrors src/lib/settle-hop.ts parseCuniSettle:
 *   CUNI <Kind>\nkey=value\n...
 * Unknown keys → fail closed (do not bind). Extra keys on parse → error.
 */
#ifndef AGENT_RIDER_CUNI_H
#define AGENT_RIDER_CUNI_H

#include <stddef.h>

#define CUNI_MAX_LINE 512
#define CUNI_MAX_VAL  256
#define CUNI_MAX_KEYS 16

typedef enum {
  CUNI_OK = 0,
  CUNI_ERR_EMPTY = 1,
  CUNI_ERR_KIND = 2,
  CUNI_ERR_EXTRA = 3,   /* maps to Chamber reject.extra */
  CUNI_ERR_MISSING = 4,
  CUNI_ERR_HASH = 5,
  CUNI_ERR_AGENT = 6,
  CUNI_ERR_REPLAY = 7
} cuni_err;

typedef struct {
  char url[CUNI_MAX_VAL];
  char etag[CUNI_MAX_VAL];
  char hash[CUNI_MAX_VAL];
  char agent_id[CUNI_MAX_VAL];
} scan_chunk;

typedef struct {
  char job_id[CUNI_MAX_VAL];
  char chunk_hash[CUNI_MAX_VAL];
  char agent_id[CUNI_MAX_VAL];
} mesh_job;

typedef struct {
  char job_id[CUNI_MAX_VAL];
  char status[CUNI_MAX_VAL]; /* sealed | open | failed */
  char hash[CUNI_MAX_VAL];
  char agent_id[CUNI_MAX_VAL];
} mesh_result;

typedef struct {
  char hop_id[CUNI_MAX_VAL];
  char job_id[CUNI_MAX_VAL];
  char key_id[CUNI_MAX_VAL];
  double amount_usd;
  double egress_gb;
  double compute_s;
  double codec_s;
} settle_hop;

cuni_err cuni_parse_scan_chunk(const char *text, scan_chunk *out);
cuni_err cuni_parse_mesh_job(const char *text, mesh_job *out);
cuni_err cuni_parse_mesh_result(const char *text, mesh_result *out);
cuni_err cuni_parse_settle_hop(const char *text, settle_hop *out);

/* Format into buf; returns bytes written (excl NUL) or -1. */
int cuni_format_scan_chunk(const scan_chunk *in, char *buf, size_t cap);
int cuni_format_mesh_job(const mesh_job *in, char *buf, size_t cap);
int cuni_format_mesh_result(const mesh_result *in, char *buf, size_t cap);
int cuni_format_settle_hop(const settle_hop *in, char *buf, size_t cap);

const char *cuni_err_str(cuni_err e);

#endif
