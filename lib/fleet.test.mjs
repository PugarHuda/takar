// Fleet decision rules, no network.  node lib/fleet.test.mjs
import assert from "node:assert/strict";
import { decideFlight, decideFieldWork, decideDelivery, runUnit, whyUnusable } from "./fleet.mjs";

const lim = { maxGustKmh: 40 };
const station = (wind, gust = null) => ({ icao: "WIII", wind_kmh: wind, gust_kmh: gust });

assert.equal(decideFlight(lim, { risk_level: "LOW", peak_gust_kmh: 20 }, station(10)).decision, "GO");
assert.equal(decideFlight(lim, null, station(10)).decision, "HOLD", "unreadable answer fails closed");
assert.equal(decideFlight(lim, { risk_level: "SEVERE", peak_gust_kmh: 90 }, station(10)).decision, "ABORT");
assert.equal(decideFlight(lim, { risk_level: "LOW", peak_gust_kmh: 55 }, station(10)).decision, "HOLD");
// Station overrules a calm answer, and the disagreement is recorded.
const c = decideFlight(lim, { risk_level: "LOW", peak_gust_kmh: 15 }, station(30, 52));
assert.equal(c.decision, "HOLD");
assert.equal(c.contradictions.length, 1);

assert.equal(decideFieldWork({ maxRainPct: 40 }, { precipitation_probability_pct: 70 }).decision, "HOLD");
assert.equal(decideFieldWork({ maxRainPct: 40 }, { precipitation_probability_pct: 10 }).decision, "GO");
assert.equal(decideFieldWork({ maxRainPct: 40 }, { precipitation_probability_pct: null }).decision, "HOLD");
// yesterday's recorded rain (WEATHER_FORECAST_VERIFY), checked only when the unit sets a limit
const wet = { maxRainPct: 40, maxRecentRainMm: 15 };
assert.equal(decideFieldWork(wet, { precipitation_probability_pct: 10 }, { precipitation_mm: 30 }).decision, "HOLD", "soaked ground holds a dry day");
assert.equal(decideFieldWork(wet, { precipitation_probability_pct: 10 }, { precipitation_mm: 3.2 }).decision, "GO");
assert.equal(decideFieldWork(wet, { precipitation_probability_pct: 10 }, null).decision, "HOLD", "no record: fail closed");
assert.equal(decideFieldWork(wet, { precipitation_probability_pct: 10 }, { precipitation_mm: null }).decision, "HOLD");

const dl = { maxGustKmh: 50, maxHours: 4 };
assert.equal(decideDelivery(dl, { duration: 3 * 3600 }, { risk_level: "LOW", peak_gust_kmh: 10 }).decision, "GO");
assert.equal(decideDelivery(dl, { duration: 6 * 3600 }, { risk_level: "LOW", peak_gust_kmh: 10 }).decision, "HOLD");
assert.equal(decideDelivery(dl, null, { risk_level: "LOW", peak_gust_kmh: 10 }).decision, "HOLD");

// Budget: a rover needs two asks; a $0.01 budget buys one, then holds.
const fakeAsk = async ({ intent }) => ({ result_shape: "intent", cost_usd: 0.01, result: intent.startsWith("ROUTE") ? { duration: 3600 } : { risk_level: "LOW", peak_gust_kmh: 5 }, ledger: {} });
const rover = { id: "r1", type: "rover", location: "A", task: { name: "t", hours: 2, destination: "B" }, limits: dl, budgetUsd: 0.01 };
const r = await runUnit(rover, { ask: fakeAsk });
assert.equal(r.decision, "HOLD");
assert.equal(r.spentUsd, 0.01);
assert.match(r.reasons.at(-1), /budget/);
assert.equal((await runUnit({ ...rover, budgetUsd: 0.05 }, { ask: fakeAsk })).decision, "GO");

// Fallback: the routed miner answers raw (off-topic); the unit re-buys from the
// next-ranked miner it has not tried, and records who failed it.
const calls = [];
const flakyAsk = async ({ minerId }) => {
  calls.push(minerId ?? "routed");
  return minerId
    ? { result_shape: "intent", cost_usd: 0.01, result: { risk_level: "LOW", peak_gust_kmh: 8 }, ledger: { miner: { id: minerId } } }
    : { result_shape: "raw", cost_usd: 0.01, result: { features: [] }, ledger: { miner: { id: "37007", name: "gdacs" } } };
};
const ranked = async () => [{ id: "37007" }, { id: "20260828" }];
const drone = { id: "d1", type: "drone", location: "X", task: { name: "t", hours: 2 }, limits: { maxGustKmh: 40 }, budgetUsd: 0.03 };
const f = await runUnit(drone, { ask: flakyAsk, ranked });
assert.deepEqual(calls, ["routed", "20260828"], "skips the miner that already failed");
assert.equal(f.decision, "GO");
assert.equal(f.unusableMiners[0].miner.id, "37007");
assert.equal(f.spentUsd, 0.02);
// Same failure with only $0.01 of budget: no second try, fail closed.
calls.length = 0;
assert.equal((await runUnit({ ...drone, budgetUsd: 0.01 }, { ask: flakyAsk, ranked })).decision, "HOLD");
assert.deepEqual(calls, ["routed"]);

// A direct ask refused before payment (503, no miner in the reply) must not be
// retried against the same miner.
calls.length = 0;
const ladder2 = async () => [{ id: "37007" }, { id: "37004" }];
const refusingAsk = async ({ minerId }) => {
  calls.push(minerId ?? "routed");
  if (!minerId) return { result_shape: "intent", cost_usd: 0.01, result: { risk_level: null }, ledger: { miner: { id: "20260828" } } };
  if (minerId === "37007") { const e = new Error("503 no_compatible_miner"); e.entry = { paidMicroUsdc: "0", miner: null }; throw e; }
  return { result_shape: "intent", cost_usd: 0.01, result: { risk_level: "LOW", peak_gust_kmh: 8 }, ledger: { miner: { id: minerId } } };
};
const g = await runUnit({ ...drone, budgetUsd: 0.05 }, { ask: refusingAsk, ranked: ladder2 });
assert.deepEqual(calls, ["routed", "37007", "37004"], "each miner asked once");
assert.equal(g.spentUsd, 0.02, "the 503 cost nothing");

// Fail-open guards: an unknown risk level, a missing gust, or a station without
// wind values must never pass as calm.
assert.equal(decideFlight(lim, { risk_level: "low", peak_gust_kmh: 5 }, station(5)).decision, "HOLD", "unknown enum spelling holds");
assert.equal(decideFlight(lim, { risk_level: "EXTREME", peak_gust_kmh: 5 }, station(5)).decision, "HOLD");
assert.equal(decideFlight(lim, { risk_level: "LOW", peak_gust_kmh: null }, station(5)).decision, "HOLD", "missing gust holds");
const quiet = decideFlight(lim, { risk_level: "LOW", peak_gust_kmh: 5 }, { icao: "WXXX", wind_kmh: null, gust_kmh: null });
assert.match(quiet.reasons.join(" "), /unconfirmed/, "no station wind is unconfirmed, not 0");

// Budget tally: a server-reported cost of 0 cannot shrink spend, and a failure
// that may have been paid counts against the budget.
const cheapLiar = async () => ({ result_shape: "intent", cost_usd: 0, result: { duration: 3600, risk_level: "LOW", peak_gust_kmh: 5 }, ledger: { paidMicroUsdc: "10000" } });
assert.equal((await runUnit({ ...rover, budgetUsd: 0.01 }, { ask: cheapLiar })).decision, "HOLD", "0-cost reply still spends 0.01");
const lost = async () => { const e = new Error("fetch failed"); e.entry = { paidMicroUsdc: "0", possiblyPaid: true }; throw e; };
assert.equal((await runUnit({ ...drone, budgetUsd: 0.05 }, { ask: lost, ranked: async () => [] })).spentUsd, 0.01, "possibly-paid failure is counted");

// Non-numeric cost and a missing budget must not open the gate.
const weird = async () => ({ result_shape: "intent", cost_usd: "free", result: { duration: 3600, risk_level: "LOW", peak_gust_kmh: 5 }, ledger: { paidMicroUsdc: "abc" } });
assert.equal((await runUnit({ ...rover, budgetUsd: 0.01 }, { ask: weird })).spentUsd, 0.01, "NaN cost counts as list price");
assert.equal((await runUnit({ ...rover, budgetUsd: undefined }, { ask: weird })).decision, "HOLD", "no budget, no buying");

// an answer about another place is unusable, however well formed (bounties#211)
const shaped = (result) => ({ result_shape: "intent", result });
const at = { place: "Bandung", country: "Indonesia" };
assert.equal(whyUnusable("STORM_ALERT_GENERAL", shaped({ risk_level: "low", location: "Bandung, West Java, Indonesia" }), at), null);
assert.match(whyUnusable("STORM_ALERT_GENERAL", shaped({ risk_level: "high", location: "Kerman, Iran" }), at), /another place/);
assert.match(whyUnusable("STORM_ALERT_GENERAL", shaped({ risk_level: "high", country: "India" }), at), /another country/);
assert.equal(whyUnusable("STORM_ALERT_GENERAL", shaped({ risk_level: "low" }), at), null, "no place field: nothing to contradict");
assert.equal(whyUnusable("STORM_ALERT_GENERAL", { result_shape: "raw", result: {} }, at), "raw answer, not the intent's shape");
assert.equal(whyUnusable("STORM_ALERT_GENERAL", shaped({ location: "Bandung" }), at), "missing a required field");
console.log("fleet rules: 42 checks ok");
