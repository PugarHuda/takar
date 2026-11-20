import assert from "node:assert/strict";
import { eventCondition, daysOf, droughtCondition } from "./settle.mjs";

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

console.log("settle rules: 16 checks ok");
