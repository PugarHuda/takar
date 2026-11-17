// Outcome resolver rules, no network.  node lib/outcome.test.mjs
import assert from "node:assert/strict";
import { latestPeriodEnd, notYetDecidable, resolve } from "./outcome.mjs";

const NOW = new Date("2026-11-17T00:00:00Z");

assert.equal(latestPeriodEnd("Will the Fed cut rates at its December 2026 FOMC meeting?").toISOString().slice(0, 10), "2027-01-01");
assert.equal(latestPeriodEnd("Did Real Madrid win the 2024-25 UEFA Champions League?").toISOString().slice(0, 10), "2026-01-01");
assert.equal(latestPeriodEnd("Who won the race?"), null);
assert.equal(latestPeriodEnd("Who won Super Bowl LX in February 2026?").toISOString().slice(0, 10), "2026-03-01", "month pins the year");
assert.equal(notYetDecidable("Who won Super Bowl LX in February 2026?", NOW), false);
assert.equal(notYetDecidable("Will the Fed cut rates at its December 2026 FOMC meeting?", NOW), true);
assert.equal(notYetDecidable("Did Max Verstappen win the 2025 Japanese Grand Prix?", NOW), false);

const TEXT = "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing, ahead of Lando Norris.";
const fakeFetch = async (url) => ({
  json: async () => (url.includes("list=search")
    ? { query: { search: [{ title: "2025 Japanese Grand Prix" }] } }
    : { query: { pages: { 1: { title: "2025 Japanese Grand Prix", fullurl: "https://en.wikipedia.org/wiki/2025_Japanese_Grand_Prix", extract: TEXT } } } }),
});
const llm = (reply) => async () => JSON.stringify(reply);
const ask = (reply, q = "Did Max Verstappen win the 2025 Japanese Grand Prix?") => resolve(q, { llm: llm(reply), fetchImpl: fakeFetch, now: NOW });

// A quoted, verifiable answer stands.
const ok = await ask({ outcome: "yes", winner: "Max Verstappen", resolved_at: "2025-04-06", evidence: "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing, ahead of Lando Norris." });
assert.equal(ok.outcome, "yes");
assert.equal(ok.resolved_yes, true);
assert.equal(ok.sources[0], "https://en.wikipedia.org/wiki/2025_Japanese_Grand_Prix");

// Invented evidence does not.
const made = await ask({ outcome: "yes", winner: "Max Verstappen", evidence: "Verstappen dominated the race from pole to flag in Suzuka." });
assert.equal(made.outcome, "unresolved");
assert.match(made.note, /evidence not found/);

// A winner the sources never name does not.
const wrong = await ask({ outcome: "yes", winner: "Charles Leclerc", evidence: "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing, ahead of Lando Norris." });
assert.equal(wrong.outcome, "unresolved");

// Future events never reach the model.
let called = false;
const future = await resolve("Will the Fed cut rates at its December 2026 FOMC meeting?", { llm: async () => { called = true; return "{}"; }, fetchImpl: fakeFetch, now: NOW });
assert.equal(future.outcome, "unresolved");
assert.equal(called, false);

// Garbage from the model is unresolved, never an error answer.
assert.equal((await resolve("Did Max Verstappen win the 2025 Japanese Grand Prix?", { llm: async () => "I think yes", fetchImpl: fakeFetch, now: NOW })).outcome, "unresolved");
await assert.rejects(resolve("", { llm: llm({}), fetchImpl: fakeFetch }), /required/);

console.log("outcome rules: 17 checks ok");
