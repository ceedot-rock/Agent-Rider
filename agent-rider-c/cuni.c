#include "cuni.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

const char *cuni_err_str(cuni_err e) {
  switch (e) {
    case CUNI_OK: return "ok";
    case CUNI_ERR_EMPTY: return "reject.empty";
    case CUNI_ERR_KIND: return "reject.kind";
    case CUNI_ERR_EXTRA: return "reject.extra";
    case CUNI_ERR_MISSING: return "reject.missing";
    case CUNI_ERR_HASH: return "reject.hash";
    case CUNI_ERR_AGENT: return "reject.agent";
    case CUNI_ERR_REPLAY: return "reject.replay";
    default: return "reject.unknown";
  }
}

static void trim(char *s) {
  size_t n = strlen(s);
  while (n && (s[n - 1] == '\n' || s[n - 1] == '\r' || isspace((unsigned char)s[n - 1])))
    s[--n] = 0;
  char *p = s;
  while (*p && isspace((unsigned char)*p)) p++;
  if (p != s) memmove(s, p, strlen(p) + 1);
}

/* allowed: list of key names ending with NULL. Returns CUNI_ERR_EXTRA on unknown key. */
static cuni_err parse_kv(const char *text, const char *kind,
                         const char **allowed,
                         int (*set)(const char *k, const char *v, void *ctx),
                         void *ctx) {
  if (!text || !*text) return CUNI_ERR_EMPTY;
  char tmp[8192];
  if (strlen(text) >= sizeof(tmp)) return CUNI_ERR_EMPTY;
  memcpy(tmp, text, strlen(text) + 1);

  char *save = NULL;
  char *line = strtok_r(tmp, "\n", &save);
  if (!line) return CUNI_ERR_EMPTY;
  trim(line);
  char expect[64];
  snprintf(expect, sizeof(expect), "CUNI %s", kind);
  if (strcmp(line, expect) != 0) return CUNI_ERR_KIND;

  int saw = 0;
  while ((line = strtok_r(NULL, "\n", &save)) != NULL) {
    trim(line);
    if (!*line) continue;
    char *eq = strchr(line, '=');
    if (!eq) return CUNI_ERR_EXTRA;
    *eq = 0;
    char *k = line;
    char *v = eq + 1;
    trim(k); trim(v);
    int ok = 0;
    for (const char **a = allowed; *a; a++) {
      if (strcmp(k, *a) == 0) { ok = 1; break; }
    }
    if (!ok) return CUNI_ERR_EXTRA;
    if (set(k, v, ctx) != 0) return CUNI_ERR_EXTRA;
    saw++;
  }
  if (!saw) return CUNI_ERR_EMPTY;
  return CUNI_OK;
}

static int set_scan(const char *k, const char *v, void *ctx) {
  scan_chunk *o = ctx;
  if (strcmp(k, "url") == 0) { snprintf(o->url, sizeof(o->url), "%s", v); return 0; }
  if (strcmp(k, "etag") == 0) { snprintf(o->etag, sizeof(o->etag), "%s", v); return 0; }
  if (strcmp(k, "hash") == 0) { snprintf(o->hash, sizeof(o->hash), "%s", v); return 0; }
  if (strcmp(k, "agent_id") == 0) { snprintf(o->agent_id, sizeof(o->agent_id), "%s", v); return 0; }
  return -1;
}

cuni_err cuni_parse_scan_chunk(const char *text, scan_chunk *out) {
  memset(out, 0, sizeof(*out));
  static const char *allow[] = {"url", "etag", "hash", "agent_id", NULL};
  cuni_err e = parse_kv(text, "ScanChunk", allow, set_scan, out);
  if (e != CUNI_OK) return e;
  if (!out->url[0] || !out->hash[0] || !out->agent_id[0]) return CUNI_ERR_MISSING;
  return CUNI_OK;
}

static int set_job(const char *k, const char *v, void *ctx) {
  mesh_job *o = ctx;
  if (strcmp(k, "job_id") == 0) { snprintf(o->job_id, sizeof(o->job_id), "%s", v); return 0; }
  if (strcmp(k, "chunk_hash") == 0) { snprintf(o->chunk_hash, sizeof(o->chunk_hash), "%s", v); return 0; }
  if (strcmp(k, "agent_id") == 0) { snprintf(o->agent_id, sizeof(o->agent_id), "%s", v); return 0; }
  return -1;
}

cuni_err cuni_parse_mesh_job(const char *text, mesh_job *out) {
  memset(out, 0, sizeof(*out));
  static const char *allow[] = {"job_id", "chunk_hash", "agent_id", NULL};
  cuni_err e = parse_kv(text, "MeshJob", allow, set_job, out);
  if (e != CUNI_OK) return e;
  if (!out->job_id[0] || !out->chunk_hash[0] || !out->agent_id[0]) return CUNI_ERR_MISSING;
  return CUNI_OK;
}

static int set_result(const char *k, const char *v, void *ctx) {
  mesh_result *o = ctx;
  if (strcmp(k, "job_id") == 0) { snprintf(o->job_id, sizeof(o->job_id), "%s", v); return 0; }
  if (strcmp(k, "status") == 0) { snprintf(o->status, sizeof(o->status), "%s", v); return 0; }
  if (strcmp(k, "hash") == 0) { snprintf(o->hash, sizeof(o->hash), "%s", v); return 0; }
  if (strcmp(k, "agent_id") == 0) { snprintf(o->agent_id, sizeof(o->agent_id), "%s", v); return 0; }
  return -1;
}

cuni_err cuni_parse_mesh_result(const char *text, mesh_result *out) {
  memset(out, 0, sizeof(*out));
  static const char *allow[] = {"job_id", "status", "hash", "agent_id", NULL};
  cuni_err e = parse_kv(text, "MeshResult", allow, set_result, out);
  if (e != CUNI_OK) return e;
  if (!out->job_id[0] || !out->status[0] || !out->hash[0] || !out->agent_id[0]) return CUNI_ERR_MISSING;
  return CUNI_OK;
}

static int set_settle(const char *k, const char *v, void *ctx) {
  settle_hop *o = ctx;
  if (strcmp(k, "hop_id") == 0) { snprintf(o->hop_id, sizeof(o->hop_id), "%s", v); return 0; }
  if (strcmp(k, "job_id") == 0) { snprintf(o->job_id, sizeof(o->job_id), "%s", v); return 0; }
  if (strcmp(k, "key_id") == 0) { snprintf(o->key_id, sizeof(o->key_id), "%s", v); return 0; }
  if (strcmp(k, "amount_usd") == 0) { o->amount_usd = atof(v); return 0; }
  if (strcmp(k, "meter") == 0) {
    double a = 0, b = 0, c = 0;
    sscanf(v, "%lf,%lf,%lf", &a, &b, &c);
    o->egress_gb = a; o->compute_s = b; o->codec_s = c;
    return 0;
  }
  return -1;
}

cuni_err cuni_parse_settle_hop(const char *text, settle_hop *out) {
  memset(out, 0, sizeof(*out));
  static const char *allow[] = {"hop_id", "job_id", "key_id", "amount_usd", "meter", NULL};
  cuni_err e = parse_kv(text, "SettleHop", allow, set_settle, out);
  if (e != CUNI_OK) return e;
  if (!out->hop_id[0] || !out->job_id[0] || !out->key_id[0]) return CUNI_ERR_MISSING;
  return CUNI_OK;
}

int cuni_format_scan_chunk(const scan_chunk *in, char *buf, size_t cap) {
  return snprintf(buf, cap,
    "CUNI ScanChunk\nurl=%s\netag=%s\nhash=%s\nagent_id=%s\n",
    in->url, in->etag, in->hash, in->agent_id);
}

int cuni_format_mesh_job(const mesh_job *in, char *buf, size_t cap) {
  return snprintf(buf, cap,
    "CUNI MeshJob\njob_id=%s\nchunk_hash=%s\nagent_id=%s\n",
    in->job_id, in->chunk_hash, in->agent_id);
}

int cuni_format_mesh_result(const mesh_result *in, char *buf, size_t cap) {
  return snprintf(buf, cap,
    "CUNI MeshResult\njob_id=%s\nstatus=%s\nhash=%s\nagent_id=%s\n",
    in->job_id, in->status, in->hash, in->agent_id);
}

int cuni_format_settle_hop(const settle_hop *in, char *buf, size_t cap) {
  return snprintf(buf, cap,
    "CUNI SettleHop\nhop_id=%s\njob_id=%s\nkey_id=%s\namount_usd=%.6f\nmeter=%.6f,%.6f,%.6f\n",
    in->hop_id, in->job_id, in->key_id, in->amount_usd,
    in->egress_gb, in->compute_s, in->codec_s);
}
