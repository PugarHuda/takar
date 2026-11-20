// Outcome resolver rules, no network.  node lib/outcome.test.mjs
import assert from "node:assert/strict";
import { latestPeriodEnd, notYetDecidable, resolve, excerpt } from "./outcome.mjs";

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

// A yes/no answer keeps its evidence but drops a winner the evidence does not name.
const wrong = await ask({ outcome: "yes", winner: "Charles Leclerc", evidence: "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing, ahead of Lando Norris." });
assert.equal(wrong.outcome, "yes");
assert.equal(wrong.winner, null);
// A "who won" answer without the winner in its evidence is unresolved.
const who = await ask({ outcome: "yes", winner: "Charles Leclerc", evidence: "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing, ahead of Lando Norris." }, "Who won the 2025 Japanese Grand Prix?");
assert.equal(who.outcome, "unresolved");
// Evidence that exists in the source but is not about the asked event is rejected.
const offTopic = await resolve("Did Lewis Hamilton win the 2019 Brazilian Grand Prix?", {
  llm: llm({ outcome: "yes", winner: null, evidence: "ahead of Lando Norris." + " ".repeat(0) }), fetchImpl: fakeFetch, now: NOW });
assert.equal(offTopic.outcome, "unresolved");
// Evidence stitched across two pages does not match any single page.
const twoPages = async (url) => ({
  json: async () => (url.includes("list=search")
    ? { query: { search: [{ title: "A" }, { title: "B" }] } }
    : { query: { pages: { 1: url.includes("titles=A") ? { title: "A", extract: "The 2025 Japanese Grand Prix was won by" } : { title: "B", extract: "Max Verstappen for Red Bull Racing." } } } }),
});
const stitched = await resolve("Did Max Verstappen win the 2025 Japanese Grand Prix?", { llm: llm({ outcome: "yes", evidence: "The 2025 Japanese Grand Prix was won by Max Verstappen for Red Bull Racing." }), fetchImpl: twoPages, now: NOW });
assert.equal(stitched.outcome, "unresolved");

// Future events never reach the model.
let called = false;
const future = await resolve("Will the Fed cut rates at its December 2026 FOMC meeting?", { llm: async () => { called = true; return "{}"; }, fetchImpl: fakeFetch, now: NOW });
assert.equal(future.outcome, "unresolved");
assert.equal(called, false);

// Garbage from the model is unresolved, never an error answer.
assert.equal((await resolve("Did Max Verstappen win the 2025 Japanese Grand Prix?", { llm: async () => "I think yes", fetchImpl: fakeFetch, now: NOW })).outcome, "unresolved");
await assert.rejects(resolve("", { llm: llm({}), fetchImpl: fakeFetch }), /required/);

// excerpt: a long chronological article keeps its lead and the paragraph that names the year asked about
const NL = String.fromCharCode(10);
const filler = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} about the committee in 1990 and earlier decades.`).join(NL);
const long = "LEAD sentence." + NL + filler + NL + "On 10 December 2025 the Federal Reserve lowered the target range by 25 basis points.";
const ex = excerpt(long, "Did the Federal Reserve cut rates in December 2025?", 2000);
assert.ok(ex.startsWith("LEAD sentence."), "keeps the lead");
assert.ok(ex.includes("On 10 December 2025 the Federal Reserve lowered"), "keeps the 2025 paragraph verbatim");
assert.ok(ex.length <= 2000, "stays under the budget");
assert.equal(excerpt("short text", "anything"), "short text", "short articles pass through");
console.log("outcome rules: 26 checks ok");
