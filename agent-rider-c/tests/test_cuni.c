#include "../cuni.h"
#include "../chamber.h"
#include "../rider.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static int fails = 0;
#define CHECK(cond, msg) do { if (!(cond)) { fprintf(stderr, "FAIL %s\n", msg); fails++; } } while (0)

int main(void) {
  scan_chunk sc = {0};
  snprintf(sc.url, sizeof(sc.url), "https://example.com/");
  snprintf(sc.etag, sizeof(sc.etag), "\"abc\"");
  snprintf(sc.hash, sizeof(sc.hash), "sha256:dead");
  snprintf(sc.agent_id, sizeof(sc.agent_id), "agt_1");

  char wire[1024];
  CHECK(cuni_format_scan_chunk(&sc, wire, sizeof(wire)) > 0, "format scan");
  scan_chunk sc2;
  CHECK(cuni_parse_scan_chunk(wire, &sc2) == CUNI_OK, "parse scan");
  CHECK(strcmp(sc2.url, sc.url) == 0, "url roundtrip");

  /* extra key fail-closed */
  char bad[1200];
  snprintf(bad, sizeof(bad), "%sbonus=1\n", wire);
  CHECK(cuni_parse_scan_chunk(bad, &sc2) == CUNI_ERR_EXTRA, "extra key");

  char code[64];
  chamber_policy pol = {0};
  CHECK(chamber_admit_scan(wire, &pol, code, sizeof(code)) == CUNI_OK, "admit");
  CHECK(strcmp(code, "admit") == 0, "admit code");
  CHECK(chamber_admit_scan(bad, &pol, code, sizeof(code)) == CUNI_ERR_EXTRA, "reject extra");
  CHECK(strcmp(code, "reject.extra") == 0, "reject.extra code");

  const char *allow[] = {"agt_1", NULL};
  pol.allow_agents = allow;
  CHECK(chamber_admit_scan(wire, &pol, code, sizeof(code)) == CUNI_OK, "allow agent");
  const char *deny[] = {"agt_other", NULL};
  pol.allow_agents = deny;
  CHECK(chamber_admit_scan(wire, &pol, code, sizeof(code)) == CUNI_ERR_AGENT, "reject agent");

  const char *seen[] = {"sha256:dead"};
  pol.allow_agents = NULL;
  pol.seen_hashes = seen;
  pol.seen_n = 1;
  CHECK(chamber_admit_scan(wire, &pol, code, sizeof(code)) == CUNI_ERR_REPLAY, "reject replay");

  /* SettleHop aligns with TS header */
  settle_hop hop = {.amount_usd = 0.01, .egress_gb = 1, .compute_s = 2, .codec_s = 3};
  snprintf(hop.hop_id, sizeof(hop.hop_id), "hop_1");
  snprintf(hop.job_id, sizeof(hop.job_id), "job_1");
  snprintf(hop.key_id, sizeof(hop.key_id), "x402:res");
  char sw[1024];
  cuni_format_settle_hop(&hop, sw, sizeof(sw));
  CHECK(strncmp(sw, "CUNI SettleHop\n", 15) == 0, "settle header");
  settle_hop hop2;
  CHECK(cuni_parse_settle_hop(sw, &hop2) == CUNI_OK, "parse settle");

  /* empty */
  CHECK(cuni_parse_scan_chunk("", &sc2) == CUNI_ERR_EMPTY, "empty");

  sitescan_counts counts = {0};
  pol.allow_agents = NULL;
  pol.seen_hashes = NULL;
  pol.seen_n = 0;
  CHECK(rider_sitescan_hop(wire, &pol, "job_9", "hop_9", "x402:demo", 0.02,
                           "reject.log", &counts) == CUNI_OK, "sitescan hop");
  CHECK(counts.admits == 1, "admit count");
  CHECK(rider_sitescan_hop(bad, &pol, "job_x", "hop_x", "x402:demo", 0.02,
                           "reject.log", &counts) != CUNI_OK, "sitescan reject");
  CHECK(counts.rejects == 1 && counts.by_extra == 1, "reject counts");

  if (fails) {
    fprintf(stderr, "%d failures\n", fails);
    return 1;
  }
  puts("ok");
  return 0;
}
