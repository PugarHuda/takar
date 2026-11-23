// Evaluation material for STORM_ALERT_GENERAL outside the United States, from GDACS (the Global
// Disaster Alert and Coordination System of the UN and the European Commission): every tropical
// cyclone it tracked from January 2024 to October 2025, with the alert level it raised and the
// countries it affected. Fetched once into evaluator/data/gdacs/tc.json so the set rebuilds byte for byte.
//
//   node evaluator/storm-global-pairs.mjs [--fetch]   -> evaluator/data/storm-alert-global.jsonl
//
// The level comes from GDACS's own alert, by a fixed rule:
//   SEVERE    Red alert      (GDACS: high humanitarian impact expected)
//   HIGH      Orange alert   (medium impact)
//   MODERATE  Green alert    (a cyclone was tracked near the country, low impact expected)
// One pair per affected country, US territories left out (the NWS set covers them). The worse answer
// has one error a judge can see: another country's cyclone, a level that contradicts the alert it
// names, a score outside 0..1, a window outside the cyclone's dates, a missing level, or a grade
// outside the allowed set. Upload form: prompt, chosen, rejected.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const dir = new URL("./data/gdacs/", import.meta.url);
const file = new URL("tc.json", dir);
if (process.argv.includes("--fetch") || !existsSync(file)) {
  mkdirSync(dir, { recursive: true });
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=2024-01-01&todate=2025-10-31&alertlevel=red;orange;green&pagenumber=${page}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) break;
    const f = (await r.json()).features ?? [];
    all.push(...f.map((x) => ({ id: x.properties.eventid, name: x.properties.name, alert: x.properties.alertlevel, from: x.properties.fromdate, to: x.properties.todate, countries: (x.properties.affectedcountries ?? []).map((c) => c.countryname) })));
    if (f.length < 100) break;
    await new Promise((res) => setTimeout(res, 1500)); // be gentle with a public service
  }
  writeFileSync(file, JSON.stringify({ source: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC", fetched: new Date().toISOString().slice(0, 10), events: all }, null, 1) + "\n");
}

const LEVEL = { Red: "SEVERE", Orange: "HIGH", Green: "MODERATE" };
const SCORE = { LOW: 0.05, MODERATE: 0.4, HIGH: 0.7, SEVERE: 0.92 };
const US = /United States|Puerto Rico|Guam|Virgin Islands \(U|Northern Mariana|American Samoa/i;
const d = (s) => String(s).slice(0, 10);
const J = (o) => JSON.stringify(o);
const events = JSON.parse(readFileSync(file, "utf8")).events
  .filter((e) => LEVEL[e.alert] && e.from && e.to)
  .sort((a, b) => a.from.localeCompare(b.from) || String(a.id).localeCompare(String(b.id)));
const rows = events.flatMap((e) => [...new Set(e.countries)].filter((c) => c && !US.test(c)).map((country) => ({ e, country })));
const pairs = [];
rows.forEach(({ e, country }, i) => {
  const lvl = LEVEL[e.alert];
  const right = { location: country, window: `${d(e.from)}T00:00Z to ${d(e.to)}T24:00Z`, risk_level: lvl, risk_score: SCORE[lvl], active_products: [`GDACS ${e.alert} alert: ${e.name} (event ${e.id})`], source: "GDACS, Global Disaster Alert and Coordination System (UN and European Commission)" };
  const other = rows.find((r) => r.country !== country && r.e.id !== e.id && Math.abs(i - rows.indexOf(r)) > 5) ?? rows[(i + 7) % rows.length];
  const shift = (s, days) => d(new Date(Date.parse(s) - days * 86_400_000).toISOString());
  const errors = [
    ["answer about a different country", { ...right, location: other.country, active_products: [`GDACS ${other.e.alert} alert: ${other.e.name} (event ${other.e.id})`] }],
    ["level contradicts the alert named", { ...right, risk_level: lvl === "SEVERE" ? "LOW" : "SEVERE", risk_score: lvl === "SEVERE" ? 0.05 : 0.92 }],
    ["score outside 0..1", { ...right, risk_score: Math.round(SCORE[lvl] * 100) }],
    ["window outside the cyclone's dates", { ...right, window: `${shift(e.from, 60)}T00:00Z to ${shift(e.from, 59)}T24:00Z` }],
    ["missing level", (({ risk_level, ...r }) => r)(right)],
    ["grade outside the allowed set", { ...right, risk_level: lvl === "SEVERE" ? "CATASTROPHIC" : "ELEVATED" }],
  ];
  const [why, wrong] = errors[i % errors.length];
  pairs.push({ prompt: `Storm or cyclone risk for ${country} from ${d(e.from)} to ${d(e.to)} (UTC)?`, chosen: J(right), rejected: J(wrong), why, lvl });
});
writeFileSync(new URL("./data/storm-alert-global.jsonl", import.meta.url), pairs.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected })).join("\n") + "\n");
const count = (k) => Object.entries(pairs.reduce((a, p) => ((a[p[k]] = (a[p[k]] ?? 0) + 1), a), {})).map(([a, b]) => `${a} ${b}`).join("; ");
console.log(`storm-alert-global.jsonl ${pairs.length} pairs from ${events.length} cyclones, ${new Set(pairs.map((p) => p.prompt)).size} unique prompts`);
console.log(`levels: ${count("lvl")}`);
console.log(`errors: ${count("why")}`);
console.log(`countries: ${new Set(rows.map((r) => r.country)).size}`);
