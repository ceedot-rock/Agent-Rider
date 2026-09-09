// Pure-JS mirror of narrow.ts rules so we can prove them without tsx.
function issueWarrant(authority) {
  return { v: 1, kind: "spl-narrow", authority, hops: [] };
}
function last(w) {
  return w.hops.length ? w.hops[w.hops.length - 1] : w.authority;
}
function attenuate(w, next) {
  const prev = last(w);
  if (next.max_cents > prev.max_cents) throw new Error("warrant_widen_cents");
  if (next.until > prev.until) throw new Error("warrant_widen_until");
  return { ...w, hops: [...w.hops, next] };
}

const until = Math.floor(Date.now() / 1000) + 3600;
let w = issueWarrant({ agent_id: "A", max_cents: 100, until });
w = attenuate(w, { agent_id: "B", max_cents: 8, until: until - 10 });
if (w.hops[0].max_cents !== 8) throw new Error("hop");
let threw = false;
try {
  attenuate(w, { agent_id: "C", max_cents: 9, until: until - 20 });
} catch (e) {
  threw = e.message === "warrant_widen_cents";
}
if (!threw) throw new Error("must refuse widen");
console.log("ok");
