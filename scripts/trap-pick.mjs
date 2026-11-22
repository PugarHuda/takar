// Pick a fresh, harder known-answer set for scripts/trap-run.mjs, without looking at what Takar can answer.
//
//   node scripts/trap-pick.mjs [--n 12] [--out receipts/trap-pool-YYYY-MM-DD.json]
//
// Resolved Manifold binary markets that closed between 1 Sep 2025 and today (after many models'
// training data), from several subjects, with at least 20 traders, and phrased about the world rather
// than about the market's author. Balanced yes and no. The truth is each market's own resolution;
// Takar's resolver is never consulted, so the set is not tuned to our miner.
import { writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", "12"));
const TERMS = ["Premier League", "NBA", "NFL", "Champions League", "election", "Fed rate", "Bitcoin", "Ethereum", "S&P 500", "inflation", "hurricane", "Oscar", "SpaceX", "earnings"];
const FROM = Date.parse("2025-09-01T00:00:00Z"), TO = Date.now() - 864e5;
const SELF = /\b(I|me|my|I'm|this market|this question|manifold|mana|resolve[sd]? (yes|no) if|in my opinion|poll)\b/i;

const pool = new Map();
for (const t of TERMS) {
  const ms = await fetch(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(t)}&filter=resolved&contractType=BINARY&sort=most-popular&limit=100`).then((r) => r.json()).catch(() => []);
  for (const m of ms) {
    if (!["YES", "NO"].includes(m.resolution) || (m.uniqueBettorCount ?? 0) < 20) continue;
    const closed = m.resolutionTime ?? m.closeTime;
    if (!(closed >= FROM && closed <= TO)) continue;
    if (SELF.test(m.question) || m.question.length > 160 || !/\?\s*$/.test(m.question)) continue;
    pool.set(m.id, { id: m.id, question: m.question, resolution: m.resolution, url: m.url, traders: m.uniqueBettorCount, closed: new Date(closed).toISOString().slice(0, 10), term: t });
  }
}
// One per subject where possible, alternating yes and no, most-traded first.
const all = [...pool.values()].sort((a, b) => b.traders - a.traders);
const pick = [], used = new Set();
for (const want of ["YES", "NO"].flatMap((r) => Array(Math.ceil(N / 2)).fill(r))) {
  const m = all.find((x) => x.resolution === want && !pick.includes(x) && !used.has(x.term)) ?? all.find((x) => x.resolution === want && !pick.includes(x));
  if (m) { pick.push(m); used.add(m.term); }
  if (pick.length >= N) break;
}
const out = arg("out", `receipts/trap-pool-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify({ title: "Known-answer traps: resolved Manifold markets closed after 1 Sep 2025, picked without consulting Takar", generated_at: new Date().toISOString(), candidates: pool.size, traps: pick }, null, 2) + "\n");
console.log(`${pick.length} traps from ${pool.size} candidates -> ${out}`);
for (const m of pick) console.log(m.resolution.padEnd(4), m.closed, m.traders, "|", m.question);
