import assert from "node:assert/strict";
import { km, berth, pair, decide } from "./trade.mjs";

const port = { lat: 60.1497, lon: 24.9155, radiusKm: 1.5 };
const now = Date.parse("2026-11-23T16:00:00Z");
const at = (lat, lon, kn, min = 5) => ({ latitude: lat, longitude: lon, speed_knots: kn, observed_at: new Date(now - min * 60_000).toISOString() });

assert.ok(Math.abs(km({ lat: 60.1497, lon: 24.9155 }, { lat: 59.4437, lon: 24.7536 }) - 79) < 3, "Helsinki-Tallinn ~79 km");
assert.equal(berth(at(60.150, 24.916, 0.1), port, now).state, "berthed");
assert.equal(berth(at(60.150, 24.916, 6), port, now).state, "away", "moving inside the harbour is not berthed");
assert.equal(berth(at(59.748, 24.793, 22.8), port, now).state, "away", "at sea");
assert.equal(berth(at(60.150, 24.916, 0, 90), port, now).state, "unusable", "stale reading");
assert.equal(berth({ latitude: null }, port, now).state, "unusable");
assert.equal(berth({ ...at(60.150, 24.916, 0), observed_at: undefined }, port, now).state, "unusable", "no time");

assert.equal(berth(at(60.150, 24.916, 0, -30), port, now).state, "unusable", "future timestamp");
assert.equal(berth({ ...at(60.150, 24.916, 0), vessel: "OTHER SHIP" }, port, now, "MEGASTAR").state, "unusable", "another ship");
assert.equal(berth({ ...at(60.150, 24.916, 0), vessel: "Megastar" }, port, now, "MEGASTAR").state, "berthed", "name case-insensitive");
assert.equal(pair(true, true, true, false), "pass");
assert.equal(pair(false, false, true, false), "fail");
assert.equal(pair(true, false, true, false), "review");
assert.equal(pair(true, null, true, false), "review", "a missing answer is doubt");

assert.equal(decide({ arrival: "pass", invoice: "pass", sanctions: "pass" })[0], "pay");
assert.equal(decide({ arrival: "fail", invoice: "pass", sanctions: "pass" })[0], "hold");
assert.equal(decide({ arrival: "pass", invoice: "fail", sanctions: "pass" })[0], "refund");
assert.equal(decide({ arrival: "pass", invoice: "review", sanctions: "pass" })[0], "review");
assert.equal(decide({ arrival: "review", invoice: "fail", sanctions: "pass" })[0], "review", "doubt beats refund");
assert.equal(decide({ arrival: "review", invoice: "review", sanctions: "fail" })[0], "refund", "sanctions hit beats everything");
console.log("trade: 20 checks ok");

import { payable } from "./trade.mjs";
assert.equal(payable(1_000_000n, 12400, [-496, -496], 496), 960_000n, "960 of 1000 accepted");
assert.equal(payable(1_000_000n, 12400, [-496, 496.4], 496), 960_000n, "sign and rounding");
assert.equal(payable(1_000_000n, 12400, [-496, -248], 496), null, "miners disagree on the shortfall");
assert.equal(payable(1_000_000n, 12400, [-496, -496], 248), null, "Praman disagrees");
assert.equal(payable(1_000_000n, 12400, [-496, null], 496), null, "one miner gave no figure");
assert.equal(payable(1_000_000n, 12400, [-12400, -12400], 12400), null, "nothing accepted is a refund, not a split");
console.log("trade payable: 6 checks ok");
