#include "rider.h"
#include <stdio.h>
#include <string.h>

/* Demo SiteScan loop with live admit/reject counts (issue #18). */
int main(void) {
  const char *agent = "agt_sitescan";
  const char *key = "x402:sitescan";
  sitescan_counts counts = {0};
  chamber_policy pol = {0};
  const char *allow[] = {"agt_sitescan", NULL};
  pol.allow_agents = allow;

  const char *urls[] = {
    "https://example.com/",
    "https://example.com/a",
    "https://example.com/b",
    NULL
  };

  for (int i = 0; urls[i]; i++) {
    char wire[1024];
    char hash[128];
    snprintf(hash, sizeof(hash), "sha256:demo%d", i);
    rider_scout_emit(urls[i], "\"e\"", hash, agent, wire, sizeof(wire));
    char job[64], hop[64];
    snprintf(job, sizeof(job), "job_%d", i);
    snprintf(hop, sizeof(hop), "hop_%d", i);
    rider_sitescan_hop(wire, &pol, job, hop, key, 0.01, "reject.log", &counts);
  }

  /* intentional extra-key reject */
  char bad[1024];
  rider_scout_emit("https://evil.example/", "\"x\"", "sha256:evil", agent, bad, sizeof(bad));
  strcat(bad, "smuggle=1\n");
  rider_sitescan_hop(bad, &pol, "job_bad", "hop_bad", key, 0.01, "reject.log", &counts);

  /* wrong agent */
  char wa[1024];
  rider_scout_emit("https://example.com/z", "\"z\"", "sha256:z", "agt_other", wa, sizeof(wa));
  rider_sitescan_hop(wa, &pol, "job_wa", "hop_wa", key, 0.01, "reject.log", &counts);

  printf("sitescan_counts admits=%u rejects=%u extra=%u agent=%u replay=%u hash=%u empty=%u\n",
         counts.admits, counts.rejects, counts.by_extra, counts.by_agent,
         counts.by_replay, counts.by_hash, counts.by_empty);
  return counts.admits > 0 && counts.by_extra > 0 ? 0 : 1;
}
