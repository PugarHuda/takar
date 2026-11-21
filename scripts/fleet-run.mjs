// One fleet tick: every unit buys what its task needs, then decides.
//
//   node --env-file=.env scripts/fleet-run.mjs [fleet.json] [--unit <id>]
//
// Costs $0.01 test USDC per ask (about $0.05 for the default fleet). Decisions
// go to receipts/decisions.jsonl next to the purchase ledger.
import { appendFileSync, readFileSync } from "node:fs";
import { ask, ranked } from "../lib/telegraph.mjs";
import { geocode, nearestStation, reports, latest, modelWind } from "../lib/observe.mjs";
import { runUnit } from "../lib/fleet.mjs";

const file = process.argv.slice(2).find((a) => a.endsWith(".json")) ?? "fleet.json";
const only = process.argv.includes("--unit") ? process.argv[process.argv.indexOf("--unit") + 1] : null;
const fleet = JSON.parse(readFileSync(file, "utf8"));
const run = new Date().toISOString();

async function observe(place) {
  const g = await geocode(place);
  const s = await nearestStation(g);
  if (!s) return modelWind(g).catch(() => null); // no instrument in range: a labelled model reading
  const now = latest(await reports(s.icao, 3));
  return now && { icao: s.icao, site: s.site, km: s.km, ...now };
}

const results = [];
for (const unit of fleet.units.filter((u) => !only || u.id === only)) {
  const r = await runUnit(unit, { ask, observe, ranked, run });
  appendFileSync("receipts/decisions.jsonl", JSON.stringify({ run, ...r }) + "\n");
  results.push(r);
}

for (const r of results) {
  console.log(`\n${r.decision.padEnd(5)} ${r.unit}  (${r.task}, ${r.location})`);
  for (const why of r.reasons) console.log(`      - ${why}`);
  for (const c of r.contradictions) console.log(`      ! contradiction: ${c}`);
  for (const u of r.unusableMiners) console.log(`      x unusable: ${u.intent} from ${u.miner?.name ?? "?"} (${u.miner?.id}) - ${u.why}`);
  for (const x of r.receipts) console.log(`      $ ${x.intent} -> ${x.miner ? `${x.miner.name} (${x.miner.id})` : "-"} ${x.tx ? `tx ${x.tx.slice(0, 12)}…` : ""}${x.error ? ` ERROR ${x.error}` : ""}`);
  console.log(`      cost $${r.spentUsd} = $${r.costPerOpHourUsd}/operating hour${r.wastedUsd ? `, $${r.wastedUsd} on unusable answers` : ""}`);
}
const total = results.reduce((s, r) => s + r.spentUsd, 0);
const wasted = results.reduce((s, r) => s + r.wastedUsd, 0);
console.log(`\nrun ${run}: ${results.length} units, $${total.toFixed(2)} of intelligence ($${wasted.toFixed(2)} unusable), ${results.filter((r) => r.decision === "GO").length} GO`);
