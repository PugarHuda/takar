// Resolved and still-open binary Manifold markets: prompts with a known correct resolution.
import { writeFileSync } from "node:fs";
const M = "https://api.manifold.markets/v0/search-markets";
const UA = { headers: { "User-Agent": "takar-eval/0.1 (+https://github.com/PugarHuda/takar)" } };
const TERMS = ["election", "win", "championship", "final", "Grand Prix", "World Cup", "Super Bowl", "NBA", "Premier League", "Oscar", "Fed", "rate cut", "CPI", "Bitcoin", "stock", "recession", "launch", "SpaceX", "release", "bill", "Supreme Court", "president", "prime minister", "referendum", "IPO", "acquisition", "GDP", "unemployment", "hurricane", "earthquake", "AI", "OpenAI", "Apple", "Tesla", "Nvidia", "war", "ceasefire", "Olympics", "tennis", "chess", "boxing", "UFC", "Eurovision", "Grammy", "box office", "court", "trial", "indicted", "resign", "summit"];
const seen = new Map();
for (const term of TERMS) for (const filter of ["resolved", "open"]) {
  const r = await fetch(`${M}?term=${encodeURIComponent(term)}&filter=${filter}&sort=most-popular&contractType=BINARY&limit=100`, UA);
  if (!r.ok) { console.log(term, filter, r.status); continue; }
  for (const m of await r.json()) {
    if (seen.has(m.id) || m.uniqueBettorCount < 15) continue;
    if (filter === "resolved" && !["YES", "NO"].includes(m.resolution)) continue;
    if (filter === "open" && !(m.closeTime > Date.now() + 7 * 864e5)) continue;
    seen.set(m.id, { id: m.id, question: m.question, url: m.url, state: filter, resolution: m.resolution ?? null, resolvedAt: m.resolutionTime ?? null, closeTime: m.closeTime ?? null, term });
  }
}
const all = [...seen.values()];
writeFileSync("data/manifold.json", JSON.stringify(all));
console.log(all.length, "resolved", all.filter((m) => m.state === "resolved").length, "open", all.filter((m) => m.state === "open").length);
