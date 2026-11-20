// Pull EVENT_OUTCOME_RESOLUTION rows (question + miner answer) from the node's public question feed.
import { writeFileSync } from "node:fs";
const B = "https://devnode.telegraphprotocol.com/daemon/api/questions";
const want = (r) => (r.routing?.intent ?? "").startsWith("EVENT_OUTCOME_RESOLUTION");
const out = [], types = {}, other = new Map();
const PAGE = 100, PAGES = Number(process.argv[2] ?? 150);
for (let p = 0; p < PAGES; p++) {
  const res = await fetch(`${B}?limit=${PAGE}&offset=${p * PAGE}`);
  if (!res.ok) { console.log("stop", res.status); break; }
  const rows = (await res.json()).results ?? [];
  if (!rows.length) break;
  for (const r of rows) { const k = `${r.type}/${r.source}`; types[k] = (types[k] ?? 0) + 1; if (want(r)) out.push(r);
    else if (r.execution?.result && other.size < 4000) { const a = JSON.stringify(r.execution.result); const k = a.slice(0, 200); if (a.length > 120 && !other.has(k)) other.set(k, { intent: r.routing?.intent ?? null, answer: a.slice(0, 2000) }); } }
  if (p % 10 === 0) console.log(p, out.length, rows.at(-1).created_at);
}
writeFileSync("data/feed-event-outcome.json", JSON.stringify(out));
// Answers to other intents: what a misrouted or catch-all miner sends back. Capped at 2000 chars each.
writeFileSync("data/feed-other.json", JSON.stringify([...other.values()]));
console.log("rows", out.length, "other", other.size, types);
