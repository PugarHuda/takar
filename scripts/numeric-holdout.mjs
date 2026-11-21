// Out-of-sample check of lib/numeric.mjs: resolved Manifold markets it has not been tuned on.
//   node scripts/numeric-holdout.mjs [--exclude ids.json] [--terms "a,b,c"] [--out receipts/numeric-holdout.json]
// Markets with fewer than 5 traders are skipped. Free: Manifold and FRED need no key.
import { readFileSync, writeFileSync } from "node:fs";
import { parse, numeric } from "../lib/numeric.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const exclude = new Set(arg("--exclude") ? JSON.parse(readFileSync(arg("--exclude"), "utf8")).map((m) => m.id) : []);
const terms = arg("--terms", "BTC,bitcoin close,S&P 500 close,SPX,ETH price,unemployment,gasoline,crude spot,bitcoin above,S&P 500 above").split(",");
const pool = new Map();
for (const t of terms) {
  const ms = await fetch(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(t)}&filter=resolved&contractType=BINARY&limit=200`).then((r) => r.json()).catch(() => []);
  for (const m of ms) if (["YES", "NO"].includes(m.resolution) && !exclude.has(m.id) && (m.uniqueBettorCount ?? 0) >= 5 && parse(m.question)) pool.set(m.id, m);
}
const rows = [];
for (const m of pool.values()) {
  const a = await numeric(m.question).catch((e) => ({ outcome: "error", note: e.message }));
  if (a?.outcome === "error") throw new Error(`${m.question}: ${a.note}`); // a data outage is not a result
  const ours = a?.outcome ?? "not taken";
  rows.push({ id: m.id, url: m.url, question: m.question, market: m.resolution.toLowerCase(), ours, evidence: a?.evidence ?? a?.note ?? null, right: ["yes", "no"].includes(ours) ? ours === m.resolution.toLowerCase() : null });
}
const answered = rows.filter((r) => r.right !== null);
const summary = { markets: rows.length, answered: answered.length, right: answered.filter((r) => r.right).length, wrong: answered.filter((r) => !r.right).length, unresolved: rows.filter((r) => r.ours === "unresolved").length, not_taken: rows.filter((r) => r.ours === "not taken").length };
summary.accuracy = answered.length ? +(summary.right / answered.length).toFixed(4) : null;
console.log(summary);
for (const r of rows.filter((r) => r.right === false)) console.log("WRONG", r.question, "|", r.ours, "|", r.evidence, "|", r.url);
writeFileSync(arg("--out", "receipts/numeric-holdout.json"), JSON.stringify({ title: "lib/numeric.mjs on resolved Manifold markets it was not tuned on", generated_at: new Date().toISOString(), terms, excluded: exclude.size, summary, rows }, null, 2) + "\n");
