#include "chamber.h"
#include <stdio.h>
#include <string.h>
#include <time.h>

static int agent_allowed(const chamber_policy *pol, const char *agent) {
  if (!pol || !pol->allow_agents) return 1;
  for (const char **a = pol->allow_agents; *a; a++) {
    if (strcmp(*a, agent) == 0) return 1;
  }
  return 0;
}

static int hash_seen(const chamber_policy *pol, const char *hash) {
  if (!pol || !pol->seen_hashes) return 0;
  for (size_t i = 0; i < pol->seen_n; i++) {
    if (pol->seen_hashes[i] && strcmp(pol->seen_hashes[i], hash) == 0) return 1;
  }
  return 0;
}

cuni_err chamber_admit_scan(const char *text, const chamber_policy *pol, char *out_code, size_t cap) {
  scan_chunk sc;
  cuni_err e = cuni_parse_scan_chunk(text, &sc);
  if (e == CUNI_ERR_EMPTY) {
    snprintf(out_code, cap, "reject.empty");
    return e;
  }
  if (e == CUNI_ERR_EXTRA || e == CUNI_ERR_KIND) {
    snprintf(out_code, cap, "reject.extra");
    return CUNI_ERR_EXTRA;
  }
  if (e == CUNI_ERR_MISSING) {
    snprintf(out_code, cap, "reject.empty");
    return e;
  }
  if (e != CUNI_OK) {
    snprintf(out_code, cap, "%s", cuni_err_str(e));
    return e;
  }
  if (!sc.hash[0]) {
    snprintf(out_code, cap, "reject.hash");
    return CUNI_ERR_HASH;
  }
  if (!agent_allowed(pol, sc.agent_id)) {
    snprintf(out_code, cap, "reject.agent");
    return CUNI_ERR_AGENT;
  }
  if (hash_seen(pol, sc.hash)) {
    snprintf(out_code, cap, "reject.replay");
    return CUNI_ERR_REPLAY;
  }
  snprintf(out_code, cap, "admit");
  return CUNI_OK;
}

int chamber_log_reject(const char *path, const char *code, const char *preview) {
  if (!path || !code) return -1;
  FILE *f = fopen(path, "a");
  if (!f) return -1;
  time_t now = time(NULL);
  char iso[32];
  strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
  /* never rehydrate full extra-key blobs — truncate preview */
  char safe[120];
  snprintf(safe, sizeof(safe), "%s", preview ? preview : "");
  for (char *p = safe; *p; p++) if (*p == '\n' || *p == '\r') *p = ' ';
  fprintf(f, "%s\t%s\t%s\n", iso, code, safe);
  fclose(f);
  return 0;
}
