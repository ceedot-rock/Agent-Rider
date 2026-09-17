#ifndef AGENT_RIDER_RIDER_H
#define AGENT_RIDER_RIDER_H

#include "chamber.h"

typedef struct {
  unsigned admits;
  unsigned rejects;
  unsigned by_extra;
  unsigned by_agent;
  unsigned by_replay;
  unsigned by_hash;
  unsigned by_empty;
} sitescan_counts;

/* Scout: emit ScanChunk wire for url into buf. */
int rider_scout_emit(const char *url, const char *etag, const char *hash,
                     const char *agent_id, char *buf, size_t cap);

/* Foreman: on admitted chunk, open MeshJob. */
cuni_err rider_foreman_open(const scan_chunk *chunk, const char *job_id,
                            mesh_job *job, char *wire, size_t cap);

/* Clerk: seal MeshResult then format SettleHop. */
cuni_err rider_clerk_settle(const mesh_job *job, const char *result_hash,
                            const char *hop_id, const char *key_id,
                            double amount_usd,
                            mesh_result *result, settle_hop *hop,
                            char *result_wire, size_t rcap,
                            char *hop_wire, size_t hcap);

/* Run one SiteScan hop; updates counts; logs rejects to reject_log_path. */
cuni_err rider_sitescan_hop(const char *scan_wire, const chamber_policy *pol,
                            const char *job_id, const char *hop_id,
                            const char *key_id, double amount_usd,
                            const char *reject_log_path,
                            sitescan_counts *counts);

#endif
