// Price/rate resolver rules, no network.  node lib/numeric.test.mjs
import assert from "node:assert/strict";
import { parse, threshold, window, numeric, recession } from "./numeric.mjs";
import { resolve } from "./outcome.mjs";

const NOW = new Date("2026-11-22T00:00:00Z");
// A fake FRED: SP500 and CBBTCUSD with a few hand-made closes.
const DATA = {
  SP500: [["2022-01-03", 4796.56], ["2023-06-30", 4450.38], ["2023-09-29", 4288.05], ["2023-12-28", 4783.35], ["2024-02-29", 5096.27], ["2024-03-01", 5137]],
  CBBTCUSD: [["2024-01-01", 44000], ["2024-04-20", 64905.95], ["2024-12-16", 106136.99], ["2024-12-31", 93000], ["2025-01-05", 98000]],
  UNRATE: [["2023-10-01", 3.8], ["2023-11-01", 3.7], ["2023-12-01", 3.7]],
};
let calls = 0;
const fred = (down = false) => async (url) => {
  calls++;
  if (down) return { ok: false, status: 403 };
  const id = new URL(url).searchParams.get("id") ?? url.split("/").pop().replace(".csv", "");
  return { ok: true, text: async () => `observation_date,${id}\n` + (DATA[id] ?? []).map(([d, v]) => `${d},${v}`).join("\n") };
};

// Parsing.
assert.deepEqual(threshold("Will Bitcoin trade at $65,000 or higher at any point in 2024?"), { op: ">=", x: 65000, reach: false });
assert.equal(threshold("Bitcoin $100K in 2024?").x, 100000);
assert.equal(threshold("Will the US unemployment rate (now 3.7%) be above 4% in November 2023?").x, 4, "the comparison's number, not the aside");
assert.deepEqual(window("Will Bitcoin be priced higher than $69,420 on April, 20th, 2024 at 4:20pm EST"), { kind: "point", from: "2024-04-20", to: "2024-04-20" });
assert.deepEqual(window("Will the S&P 500 increase in Q3 2023?"), { kind: "range", from: "2023-07-01", to: "2023-09-30" });
assert.equal(window("Will the Bitcoin price drop below $39,000 before the end of Jan 2024?").kind, "by", "a deadline, not the month's close");
// Refusals: not taken at all.
for (const q of [
  "Will Bitcoin be above $50,000 by March 1st, 2025?", // deadline with no start
  "Will 1 bitcoin be worth $100,000 or more before 2025?",
  "Conditional on the price of bitcoin going below $20k, will it go below $10k in 2022?",
  "Will the S&P 500 hit 6000 again in 2025?",
  "Will Brent crude close above $120 on April 15th, 2026?", // oil without "spot": may settle on futures
  "Will oil rise to $150 a barrel, AND the gas price top $5.000 per 1.000 cubic meters in 2023?",
  "Will US Average Gas Prices rise or fall 10 cents in one day in May 2026?",
  "S&P 500 drops 8%+ by April 2025 post-Liberation Day?",
  "Did Max Verstappen win the 2025 Japanese Grand Prix?",
]) assert.equal(parse(q), null, q);
assert.equal(parse("Will the Bitcoin lightning network reach a public capacity of at least 8000 BTC in 2023?"), null, "a BTC amount is not a price");
assert.equal(parse("Will S&P 500 increase more than Nasdaq Composite in March 2023?"), null, "a comparison with another series");
assert.equal(parse("Will the WTI Crude Oil Spot Price be above $95 on March 20, 2026?").series.id, "DCOILWTICO");

// Settling, against the fake series.
const ask = (q, down) => numeric(q, { fetchImpl: fred(down), now: NOW });
let a = await ask("Will Bitcoin be priced higher than $69,420 on April, 20th, 2024 at 4:20pm EST");
assert.equal(a.outcome, "no"); assert.match(a.evidence, /64905\.95 on 2024-04-20/); assert.equal(a.sources[0], "https://fred.stlouisfed.org/series/CBBTCUSD");
assert.equal((await ask("Will Bitcoin reach $90000 in 2024")).outcome, "yes");
assert.equal((await ask("Will the S&P 500 be above 5000 at the end of Feb 2024?")).outcome, "yes");
assert.equal((await ask("Will the S&P 500 increase in Q3 2023?")).outcome, "no");
a = await ask("32. Will the S&P 500 index reach a new all-time high in 2023?");
assert.equal(a.outcome, "no", "4783 in 2023 against 4796 in 2022"); assert.match(a.evidence, /4796\.56 on 2022-01-03/);
assert.equal((await ask("37. Will the US unemployment rate (now 3.7%) be above 4% in November 2023?")).outcome, "no");
a = await ask("Will Bitcoin reach $105,000 in 2024?");
assert.equal(a.outcome, "unresolved", "106137 is within 3% of 105000"); assert.match(a.note, /within 3%/);
a = await ask("Will Bitcoin reach $90000 in 2026?");
assert.equal(a.outcome, "unresolved"); assert.match(a.note, /not ended/);
assert.equal(await ask("Will Bitcoin reach $2.500 in 2024?"), null, "a threshold off the series' scale is a misread number");
// FRED down: numeric throws, resolve() falls through to its other sources instead of failing.
await assert.rejects(ask("Will Bitcoin reach $90000 in 2024", true));
const wiki = async (url) => (url.includes("fred.stlouisfed") ? { ok: false, status: 403 } : url.includes("polymarket") ? { ok: true, json: async () => [] } : { ok: true, json: async () => ({ query: { search: [] } }) });
const r = await resolve("Will Bitcoin reach $91000 in 2024", { llm: async () => "{}", fetchImpl: wiki, now: NOW });
assert.equal(r.outcome, "unresolved"); assert.notEqual(r.resolution_rule, undefined);
// The whole series is read once and cached: two more questions, no new reads of SP500.
calls = 0; const f = fred();
await numeric("Will S&P 500 increase in May 2023?", { fetchImpl: f, now: NOW }).catch(() => null);
await numeric("Will the S&P 500 be above 4000 at the end of Feb 2024?", { fetchImpl: f, now: NOW });
assert.equal(calls, 1, "one read per series");
// Fed decisions from the target's upper bound; one meeting only.
DATA.DFEDTARU = [["2024-08-31", 5.5], ["2024-09-17", 5.5], ["2024-09-19", 5], ["2024-09-30", 5], ["2024-10-31", 5]];
let fed = await ask("Did the US Federal Reserve cut its policy rate at the September 18 2024 FOMC meeting?");
assert.equal(fed.outcome, "yes"); assert.match(fed.evidence, /5.5 on 2024-08-31 before, 5 on 2024-09-19 after/);
assert.equal((await ask("Did the Fed cut rates by 25 bps in September 2024?")).outcome, "no", "it was 50");
assert.equal((await ask("Did the Fed cut rates by 50 basis points in September 2024?")).outcome, "yes");
assert.equal((await ask("Did the Fed hold rates in October 2024?")).outcome, "yes");
for (const q of ["Will the Federal Reserve cut rates by May 2025?", "Will the Fed issue any rate cuts from May 2025 to end of 2025?", "Will the FOMC stay with its March 2024 indication of 3 rate cuts?", "Will the S&P 500 drop 25% below its current all time high in 2025?"]) assert.equal(parse(q), null, q);
assert.notEqual(parse("Will Bitcoin trade at $65,000 or higher at any point in 2024?"), null, "or higher is a threshold, not a compound question");
assert.equal(window("Will Bitcoin be above $100k at the close of December 2024?").to, "2024-12-31");
assert.equal(window("Will Ethereum close above $3000 at the end of 2024?").kind, "end");
// Technical recession: both falling quarters inside the window; a pair across its edge is unresolved.
DATA.CLVMNACSCAB1GQDE = [["2022-07-01", 100], ["2022-10-01", 99.6], ["2023-01-01", 99.0], ["2023-04-01", 98.9], ["2023-07-01", 99.2], ["2023-10-01", 99.5], ["2024-01-01", 99.7]];
DATA.GDPC1 = [["2021-10-01", 100], ["2022-01-01", 99.5], ["2022-04-01", 101], ["2022-07-01", 102], ["2022-10-01", 101], ["2023-01-01", 101.6]];
let rec = await ask("Will Germany experience negative economic growth for two consecutive quarters in 2023? (Recession in Germany)");
assert.equal(rec.outcome, "unresolved", "-0.10% is within the revision margin"); assert.match(rec.note, /within 0.3% of zero/);
assert.equal((await ask("Did the US have two consecutive quarters of negative GDP growth in 2022?")).outcome, "no", "one falling quarter is not two");
assert.equal(recession("Will the US enter a recession by first half of 2025? (Two quarters negative GDP growth)"), null, "a deadline has no start");
assert.equal(recession("Do professional economic forecasters expect a US recession (two quarters negative GDP growth) to begin in 2025?"), null, "a question about beliefs");
assert.equal(recession("Will the US enter a recession in 2025?"), null, "no definition named");
// One-day moves, close to close, with room for intraday and other exchanges' closes.
const MOVES = {
  CBBTCUSD: [["2024-02-29", 61000], ["2024-03-01", 62000], ["2024-03-02", 67890], ["2024-03-03", 66000], ["2024-03-31", 70000]],
  SP500: [["2024-03-28", 5254], ["2024-04-01", 5243], ["2024-04-02", 5305.9], ["2024-04-30", 5035], ["2024-08-02", 5346.56], ["2024-08-05", 5186.33], ["2024-08-30", 5648]],
};
const moveFred = (data) => async (url) => {
  const id = new URL(url).searchParams.get("id") ?? url.split("/").pop().replace(".csv", "");
  return { ok: true, text: async () => `observation_date,${id}\n` + (data[id] ?? []).map(([d, v]) => `${d},${v}`).join("\n") };
};
const mv = (q, data = MOVES) => numeric(q, { fetchImpl: moveFred(data), now: NOW });
assert.deepEqual([parse("Will Bitcoin (BTC) increase by over 6% on any day in Mar 2024?").test, parse("Will Bitcoin (BTC) increase by over 6% on any day in Mar 2024?").x], ["move", 0.06]);
assert.equal(parse("Will the S&P 500 fall more than 2% in a single day in August 2024?").dir, "down");
assert.equal(parse("Will Bitcoin increase by over 6% on any day in Mar 2024 and close above 70k?"), null, "compound question");
assert.equal(parse("Will Bitcoin increase by over 6% on any day by March 2024?"), null, "a deadline has no start");
assert.equal((await mv("Will Bitcoin increase by over 6% on any day in Mar 2024?")).outcome, "yes", "62000 to 67890 is 9.5%");
assert.equal((await mv("Will Bitcoin increase by over 9% on any day in Mar 2024?")).outcome, "unresolved", "9.5% against 9% is inside the 10% room");
assert.equal((await mv("Will S&P 500 increase by over 1.5% on any day in Apr 2024?")).outcome, "no", "largest rise 1.20%");
assert.equal((await mv("Will S&P 500 increase by over 1.3% on any day in Apr 2024?")).outcome, "unresolved", "1.20% against 1.3% is inside 0.15 points");
assert.equal((await mv("Will the S&P 500 fall more than 2% in a single day in August 2024?")).outcome, "yes", "5346.56 to 5186.33 is a 3.00% fall");
assert.match((await mv("Will the S&P 500 fall more than 2% in a single day in August 2024?")).evidence, /2024-08-02 to close 2024-08-05/);
console.log("numeric resolver: 60 checks ok");
