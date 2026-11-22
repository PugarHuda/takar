// Evaluation material for STORM_ALERT_GENERAL from the official US National Weather Service record:
// every watch, warning and advisory (VTEC) in force at a point, as archived by the Iowa Environmental
// Mesonet (mesonet.agron.iastate.edu/json/vtec_events_bypoint.py). Fetched once into
// evaluator/data/iem/<city>.json so the set rebuilds byte for byte.
//
//   node evaluator/storm-pairs.mjs [--fetch]   -> evaluator/data/storm-alert.jsonl
//
// Per city, from 2024: the two days with the strongest product in force, one day with only a watch or
// advisory, and two days with none.
// The level comes from the products alone, by a fixed rule:
//   SEVERE    a hurricane, tornado, extreme wind or storm surge warning
//   HIGH      any other warning (tropical storm, high wind, severe thunderstorm, winter storm, blizzard, flood...)
//   MODERATE  a watch or an advisory
//   LOW       nothing in force
// The better answer names the place, the 24-hour UTC window, the level, a score for that level and the
// products that set it. The worse answer has one error a judge can see from the question and the answer:
// an answer about a different place (a real failure we recorded on 21 Nov: one miner answered every place
// with a cyclone in India), a level that contradicts the warnings it lists, a score outside 0..1, the
// wrong day, a missing level, or a level outside the allowed grades. Upload form: prompt, chosen, rejected.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const CITIES = [
  ["Tampa, Florida", 27.95, -82.46], ["Miami, Florida", 25.76, -80.19], ["Houston, Texas", 29.76, -95.37],
  ["New Orleans, Louisiana", 29.95, -90.07], ["Charleston, South Carolina", 32.78, -79.93], ["Wilmington, North Carolina", 34.23, -77.94],
  ["Oklahoma City, Oklahoma", 35.47, -97.52], ["Wichita, Kansas", 37.69, -97.34], ["Omaha, Nebraska", 41.26, -95.93],
  ["Des Moines, Iowa", 41.59, -93.62], ["Chicago, Illinois", 41.88, -87.63], ["Detroit, Michigan", 42.33, -83.05],
  ["Buffalo, New York", 42.89, -78.88], ["Boston, Massachusetts", 42.36, -71.06], ["New York, New York", 40.71, -74.01],
  ["Denver, Colorado", 39.74, -104.99], ["Minneapolis, Minnesota", 44.98, -93.27], ["Nashville, Tennessee", 36.16, -86.78],
  ["Atlanta, Georgia", 33.75, -84.39], ["Asheville, North Carolina", 35.60, -82.55], ["Jackson, Mississippi", 32.30, -90.18],
  ["Little Rock, Arkansas", 34.75, -92.29], ["Seattle, Washington", 47.61, -122.33], ["Phoenix, Arizona", 33.45, -112.07],
  ["Anchorage, Alaska", 61.22, -149.90],
];
const dir = new URL("./data/iem/", import.meta.url);
const slug = (c) => c.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "");

if (process.argv.includes("--fetch")) {
  mkdirSync(dir, { recursive: true });
  for (const [c, lat, lon] of CITIES) {
    if (existsSync(new URL(`${slug(c)}.json`, dir))) continue;
    const r = await fetch(`https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=${lat}&lon=${lon}&sdate=2024-01-01&edate=2025-01-01`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${c}: ${r.status}`);
    writeFileSync(new URL(`${slug(c)}.json`, dir), await r.text());
    await new Promise((res) => setTimeout(res, 1500)); // be gentle with a free archive
  }
}

const SEVERE = new Set(["HU", "TO", "EW", "SS"]);
const level = (evs) => {
  if (evs.some((e) => e.significance === "W" && SEVERE.has(e.phenomena))) return "SEVERE";
  if (evs.some((e) => e.significance === "W")) return "HIGH";
  if (evs.some((e) => e.significance === "A" || e.significance === "Y")) return "MODERATE";
  return "LOW";
};
const SCORE = { LOW: 0.05, MODERATE: 0.4, HIGH: 0.7, SEVERE: 0.92 };
const RANK = { LOW: 0, MODERATE: 1, HIGH: 2, SEVERE: 3 };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const inDay = (evs, d) => {
  const a = Date.parse(`${d}T00:00:00Z`), b = a + 86_400_000;
  return evs.filter((e) => Date.parse(e.issue) < b && Date.parse(e.expire) > a);
};
const J = (o) => JSON.stringify(o);
const pairs = [];
let i = 0;
for (const [city] of CITIES) {
  const evs = JSON.parse(readFileSync(new URL(`${slug(city)}.json`, dir), "utf8")).events ?? [];
  const days = [];
  for (let t = Date.parse("2024-01-01T00:00:00Z"); t < Date.parse("2025-01-01T00:00:00Z"); t += 86_400_000) days.push(day(t));
  const scored = days.map((d) => ({ d, in: inDay(evs, d) })).map((x) => ({ ...x, lvl: level(x.in) }));
  // Strongest two days (earliest on ties, at least 10 days apart) and two quiet days spread over the year.
  const strong = [];
  for (const x of [...scored].sort((a, b) => RANK[b.lvl] - RANK[a.lvl] || a.d.localeCompare(b.d))) {
    if (x.lvl === "LOW" || strong.some((s) => Math.abs(Date.parse(s.d) - Date.parse(x.d)) < 10 * 86_400_000)) continue;
    strong.push(x);
    if (strong.length === 2) break;
  }
  const quiet = scored.filter((x) => x.lvl === "LOW");
  const moderate = scored.filter((x) => x.lvl === "MODERATE");
  const picks = [...strong, moderate[Math.floor(moderate.length / 2)], quiet[Math.floor(quiet.length * 0.3)], quiet[Math.floor(quiet.length * 0.8)]].filter(Boolean);
  for (const x of picks) {
    // The products that set the level come first, so the cap of six never drops the decisive one.
    const weight = (e) => (e.significance === "W" ? (SEVERE.has(e.phenomena) ? 0 : 1) : 2);
    const products = [...new Set([...x.in].sort((p, q) => weight(p) - weight(q)).map((e) => `${e.name} (NWS ${e.wfo}, ${e.ugc})`))].slice(0, 6);
    const right = { location: city, window: `${x.d}T00:00Z to ${x.d}T24:00Z`, risk_level: x.lvl, risk_score: SCORE[x.lvl], active_products: products, source: "US National Weather Service VTEC record, via the Iowa Environmental Mesonet archive" };
    const elsewhere = { ...right, location: "Kolkata, India", risk_level: "SEVERE", risk_score: 0.92, active_products: ["Cyclone warning, Bay of Bengal"] };
    const contradiction = x.lvl === "LOW"
      ? { ...right, risk_level: "SEVERE", risk_score: 0.92, active_products: [] } // grades severe while listing nothing
      : { ...right, risk_level: "LOW", risk_score: 0.05 }; // grades low while listing warnings
    const errors = [
      ["answer about a different place", elsewhere],
      ["level contradicts the products listed", contradiction],
      ["score outside 0..1", { ...right, risk_score: Math.round(SCORE[x.lvl] * 100) }],
      ["wrong day", { ...right, window: `${day(Date.parse(x.d) - 7 * 86_400_000)}T00:00Z to ${day(Date.parse(x.d) - 7 * 86_400_000)}T24:00Z` }],
      ["missing level", (({ risk_level, ...r }) => r)(right)],
      ["grade outside the allowed set", { ...right, risk_level: x.lvl === "LOW" ? "NONE" : "EXTREME" }],
    ];
    const [why, wrong] = errors[i++ % errors.length];
    pairs.push({ prompt: `Storm or severe-weather risk for ${city} on ${x.d} (UTC, 24 hours)?`, chosen: J(right), rejected: J(wrong), why, lvl: x.lvl });
  }
}
writeFileSync(new URL("./data/storm-alert.jsonl", import.meta.url), pairs.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected })).join("\n") + "\n");
const count = (k) => Object.entries(pairs.reduce((a, p) => ((a[p[k]] = (a[p[k]] ?? 0) + 1), a), {})).map(([a, b]) => `${a} ${b}`).join("; ");
console.log(`storm-alert.jsonl ${pairs.length} pairs, ${new Set(pairs.map((p) => p.prompt)).size} unique prompts`);
console.log(`levels: ${count("lvl")}`);
console.log(`errors: ${count("why")}`);
