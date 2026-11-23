// What the weather actually did during each drone window, from the nearest airport's METAR reports
// (aviationweather.gov keeps 7 days). Scores Takar's decisions and the naive one-answer unit's
// (receipts/fleet-counterfactual.json) against the observed wind, gusts and thunderstorms.
//
//   node scripts/fleet-outcomes.mjs   -> receipts/fleet-outcomes.json
//
// Observed bad = a gust or sustained wind above the unit's limit, or a thunderstorm (TS) reported,
// at the station inside the task window. A station is 10-20 km away, so this is evidence, not proof.
import { readFileSync, writeFileSync } from "node:fs";
import { reports } from "../lib/observe.mjs";

const KT = 1.852;
const fleet = JSON.parse(readFileSync("fleet.json", "utf8"));
const units = new Map((fleet.units ?? fleet).map((u) => [u.id, u]));
const cf = JSON.parse(readFileSync("receipts/fleet-counterfactual.json", "utf8"));
const naive = new Map(cf.rows.map((r) => [`${r.run}|${r.unit}`, r.naive]));
const decisions = readFileSync("receipts/decisions.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** Worst conditions in [from, to] from METAR objects; pure, tested below. */
export function worst(obs, from, to) {
  const inside = obs.filter((o) => { const t = Date.parse(o.reportTime); return t >= from && t <= to; });
  if (!inside.length) return null;
  let wind = 0, gust = 0, ts = false;
  for (const o of inside) {
    wind = Math.max(wind, (o.wspd ?? 0) * KT);
    const g = String(o.rawOb ?? "").match(/\b\d{3}\d{2,3}G(\d{2,3})KT\b/);
    if (g) gust = Math.max(gust, Number(g[1]) * KT);
    if (/\s[-+]?(VC)?TS/.test(` ${o.rawOb ?? ""}`)) ts = true;
  }
  return { reports: inside.length, wind_kmh: +wind.toFixed(1), gust_kmh: +gust.toFixed(1), thunderstorm: ts };
}

if (process.argv[1]?.endsWith("fleet-outcomes.mjs")) {
  const cache = new Map();
  const rows = [];
  for (const d of decisions) {
    const u = units.get(d.unit);
    const limit = u?.limits?.maxGustKmh;
    if (!limit || !d.station?.icao) continue;
    const from = Date.parse(d.run), to = from + (u.task?.hours ?? 1) * 3600_000;
    if (to > Date.now()) continue;
    if (!cache.has(d.station.icao)) cache.set(d.station.icao, await reports(d.station.icao, 168).catch(() => []));
    const w = worst(cache.get(d.station.icao), from, to);
    if (!w) { rows.push({ run: d.run, unit: d.unit, station: d.station.icao, outcome: "no reports in window" }); continue; }
    const bad = w.thunderstorm || Math.max(w.wind_kmh, w.gust_kmh) > limit;
    rows.push({ run: d.run, unit: d.unit, location: d.location, station: d.station.icao, limit_kmh: limit, takar: d.decision, naive: naive.get(`${d.run}|${d.unit}`) ?? null, observed: w, bad });
  }
  const scored = rows.filter((r) => r.observed);
  const count = (f) => scored.filter(f).length;
  const summary = {
    windows_scored: scored.length,
    observed_bad: count((r) => r.bad),
    takar_flew_into_bad: count((r) => r.takar === "GO" && r.bad),
    takar_held_in_bad: count((r) => r.takar !== "GO" && r.bad),
    naive_flew_into_bad: count((r) => r.naive === "GO" && r.bad),
    // The windows where the two differ: Takar held, the naive unit flew.
    differ_bad: count((r) => r.takar !== "GO" && r.naive === "GO" && r.bad),
    differ_calm: count((r) => r.takar !== "GO" && r.naive === "GO" && !r.bad),
  };
  writeFileSync("receipts/fleet-outcomes.json", JSON.stringify({ title: "Drone decisions against the weather the nearest airport reported in the task window", generated_at: new Date().toISOString(), method: "METAR reports from aviationweather.gov (7 days kept) for the station each decision used; bad = gust or wind above the unit's limit, or a thunderstorm reported, between the decision and the end of the task. The station is 10-20 km away, so this is evidence, not proof.", summary, rows }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 1));
  for (const r of scored.filter((r) => r.takar !== r.naive || r.bad)) console.log(r.run.slice(0, 16), r.unit, "takar", r.takar, "naive", r.naive, JSON.stringify(r.observed), r.bad ? "BAD" : "calm");
}
