#include "rider.h"
#include <stdio.h>
#include <string.h>

int rider_scout_emit(const char *url, const char *etag, const char *hash,
                     const char *agent_id, char *buf, size_t cap) {
  scan_chunk sc;
  memset(&sc, 0, sizeof(sc));
  snprintf(sc.url, sizeof(sc.url), "%s", url ? url : "");
  snprintf(sc.etag, sizeof(sc.etag), "%s", etag ? etag : "");
  snprintf(sc.hash, sizeof(sc.hash), "%s", hash ? hash : "");
  snprintf(sc.agent_id, sizeof(sc.agent_id), "%s", agent_id ? agent_id : "");
  return cuni_format_scan_chunk(&sc, buf, cap);
}

cuni_err rider_foreman_open(const scan_chunk *chunk, const char *job_id,
                            mesh_job *job, char *wire, size_t cap) {
  if (!chunk || !job_id) return CUNI_ERR_EMPTY;
  memset(job, 0, sizeof(*job));
  snprintf(job->job_id, sizeof(job->job_id), "%s", job_id);
  snprintf(job->chunk_hash, sizeof(job->chunk_hash), "%s", chunk->hash);
  snprintf(job->agent_id, sizeof(job->agent_id), "%s", chunk->agent_id);
  if (cuni_format_mesh_job(job, wire, cap) < 0) return CUNI_ERR_EMPTY;
  return CUNI_OK;
}

cuni_err rider_clerk_settle(const mesh_job *job, const char *result_hash,
                            const char *hop_id, const char *key_id,
                            double amount_usd,
                            mesh_result *result, settle_hop *hop,
                            char *result_wire, size_t rcap,
                            char *hop_wire, size_t hcap) {
  if (!job || !result_hash || !hop_id || !key_id) return CUNI_ERR_EMPTY;
  memset(result, 0, sizeof(*result));
  snprintf(result->job_id, sizeof(result->job_id), "%s", job->job_id);
  snprintf(result->status, sizeof(result->status), "sealed");
  snprintf(result->hash, sizeof(result->hash), "%s", result_hash);
  snprintf(result->agent_id, sizeof(result->agent_id), "%s", job->agent_id);
  cuni_format_mesh_result(result, result_wire, rcap);

  memset(hop, 0, sizeof(*hop));
  snprintf(hop->hop_id, sizeof(hop->hop_id), "%s", hop_id);
  snprintf(hop->job_id, sizeof(hop->job_id), "%s", job->job_id);
  snprintf(hop->key_id, sizeof(hop->key_id), "%s", key_id);
  hop->amount_usd = amount_usd;
  hop->egress_gb = 0.001;
  hop->compute_s = 0.1;
  hop->codec_s = 0.01;
  cuni_format_settle_hop(hop, hop_wire, hcap);
  return CUNI_OK;
}

static void bump_reject(sitescan_counts *c, const char *code) {
  if (!c) return;
  c->rejects++;
  if (strcmp(code, "reject.extra") == 0) c->by_extra++;
  else if (strcmp(code, "reject.agent") == 0) c->by_agent++;
  else if (strcmp(code, "reject.replay") == 0) c->by_replay++;
  else if (strcmp(code, "reject.hash") == 0) c->by_hash++;
  else if (strcmp(code, "reject.empty") == 0) c->by_empty++;
}

cuni_err rider_sitescan_hop(const char *scan_wire, const chamber_policy *pol,
                            const char *job_id, const char *hop_id,
                            const char *key_id, double amount_usd,
                            const char *reject_log_path,
                            sitescan_counts *counts) {
  char code[64];
  cuni_err e = chamber_admit_scan(scan_wire, pol, code, sizeof(code));
  if (e != CUNI_OK) {
    bump_reject(counts, code);
    if (reject_log_path) chamber_log_reject(reject_log_path, code, scan_wire);
    return e;
  }
  scan_chunk sc;
  if (cuni_parse_scan_chunk(scan_wire, &sc) != CUNI_OK) {
    bump_reject(counts, "reject.empty");
    return CUNI_ERR_EMPTY;
  }
  mesh_job job;
  char job_wire[1024];
  e = rider_foreman_open(&sc, job_id, &job, job_wire, sizeof(job_wire));
  if (e != CUNI_OK) return e;

  mesh_result result;
  settle_hop hop;
  char rw[1024], hw[1024];
  /* sealed result hash derived from chunk hash for determinism in demo loop */
  char rh[CUNI_MAX_VAL];
  snprintf(rh, sizeof(rh), "sealed:%.240s", sc.hash);
  e = rider_clerk_settle(&job, rh, hop_id, key_id, amount_usd,
                         &result, &hop, rw, sizeof(rw), hw, sizeof(hw));
  if (e != CUNI_OK) return e;
  if (counts) counts->admits++;
  return CUNI_OK;
}
