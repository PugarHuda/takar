import assert from "node:assert/strict";
import { eventCondition, daysOf, droughtCondition , eventQuorum, droughtAgrees } from "./settle.mjs";

// Mission 14: only a clear yes or no settles
assert.equal(eventCondition({ outcome: "yes", winner: "Argentina" }).met, true);
assert.equal(eventCondition({ outcome: "no" }).met, false);
assert.equal(eventCondition({ outcome: "unresolved" }), null, "unresolved waits");
assert.equal(eventCondition(null), null, "no answer waits");
assert.equal(eventCondition({ outcome: "YES" }).met, true, "case-insensitive");

// cover periods
assert.deepEqual(daysOf("2026-11-17", "2026-11-19"), ["2026-11-17", "2026-11-18", "2026-11-19"]);
assert.throws(() => daysOf("2026-11-19", "2026-11-17"), /1 to 31 days/);
assert.throws(() => daysOf("2026-01-01", "2026-03-01"), /1 to 31 days/);

// Mission 06: every day must be recorded, and the trigger is strict
const days = ["2026-11-17", "2026-11-18"];
const r = (date, precipitation_mm) => ({ date, precipitation_mm });
assert.equal(droughtCondition([r(days[0], 1), r(days[1], 2)], { days, triggerMm: 10 }).met, true, "dry period pays");
assert.equal(droughtCondition([r(days[0], 6), r(days[1], 6)], { days, triggerMm: 10 }).met, false, "wet period refunds");
assert.equal(droughtCondition([r(days[0], 5), r(days[1], 5)], { days, triggerMm: 10 }).met, false, "exactly at the trigger does not pay");
assert.equal(droughtCondition([r(days[0], 1)], { days, triggerMm: 10 }), null, "a missing day waits, never pays");
assert.equal(droughtCondition([r(days[0], 1), r(days[1], null)], { days, triggerMm: 10 }), null, "an unreadable day waits");
assert.equal(droughtCondition([r(days[0], 1), r(days[1], -3)], { days, triggerMm: 10 }), null, "a negative reading is not a reading");
assert.equal(droughtCondition([r(days[0], 1.04), r(days[1], 2.02)], { days, triggerMm: 10 }).totalMm, 3.1);

// Mission 14 quorum: two distinct miners, agreeing
const ans = (id, outcome, sig) => ({ miner: { id, name: "m" + id }, result: { outcome }, signal: sig });
const q2 = eventQuorum([ans("1", "yes", "0xa"), ans("2", "yes", "0xb")]);
assert.equal(q2.met, true); assert.deepEqual(q2.signals, ["0xa", "0xb"]);
assert.match(eventQuorum([ans("1", "yes", "0xa"), ans("1", "yes", "0xb")]).hold, /two are needed/, "one miner twice is one vote");
assert.match(eventQuorum([ans("1", "yes", "0xa"), ans("2", "no", "0xb")]).hold, /disagree/, "a split is never settled");
assert.match(eventQuorum([ans("1", "yes", "0xa"), ans("2", "unresolved", "0xb")]).hold, /two are needed/);
assert.equal(eventQuorum([ans("1", "no", "0xa"), ans("2", "no", "0xb"), ans("3", "no", "0xc")]).signals.length, 3);
// Mission 06 second source: same side of the trigger, or hold
const dec = droughtCondition([r(days[0], 3), r(days[1], 3)], { days, triggerMm: 10 });
assert.equal(droughtAgrees(dec, [r(days[0], 4), r(days[1], 4)], { days, triggerMm: 10 }).independentMm, 8);
assert.match(droughtAgrees(dec, [r(days[0], 6), r(days[1], 6)], { days, triggerMm: 10 }).hold, /disagree/);
assert.match(droughtAgrees(dec, [r(days[0], 4), r(days[1], null)], { days, triggerMm: 10 }).hold, /not published/);
assert.equal(droughtAgrees(null, [], { days, triggerMm: 10 }), null);

assert.match(eventQuorum([ans("1", "yes", "0xa"), { miner: null, result: { outcome: "yes" }, signal: "0xb" }]).hold, /two are needed/, "an answer with no miner is not a vote");
console.log("settle rules: 28 checks ok");
