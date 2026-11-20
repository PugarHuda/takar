// Outcome resolver rules, no network.  node lib/outcome.test.mjs
import assert from "node:assert/strict";
import { latestPeriodEnd, notYetDecidable, resolve, excerpt, polymarket, openrouter } from "./outcome.mjs";

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
// Polymarket: exact title, closed, one outcome at >= 0.99; anything else falls through (null)
const gamma = (events) => async () => ({ ok: true, json: async () => ({ events }) });
const mk = (question, outcomes, prices, extra = {}) => ({ question, outcomes: JSON.stringify(outcomes), outcomePrices: JSON.stringify(prices), closed: true, closedTime: "2026-02-28 21:00:00+00", ...extra });
const ud = await polymarket("Bitcoin Up or Down - February 28", { fetchImpl: gamma([{ title: "Bitcoin Up or Down - February 28", slug: "btc-feb-28", markets: [mk("Bitcoin Up or Down - February 28", ["Up", "Down"], ["0", "1"])] }]) });
assert.equal(ud.winner, "Down"); assert.equal(ud.outcome, "down"); assert.equal(ud.resolved_yes, null);
assert.ok(ud.sources[0].endsWith("/btc-feb-28") && ud.evidence.includes("Down"));
const yn = await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "Mets vs Braves", markets: [mk("New York Mets to win", ["Yes", "No"], ["1", "0"])] }]) });
assert.equal(yn.outcome, "yes"); assert.equal(yn.resolved_yes, true); assert.equal(yn.winner, null);
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win the World Series", ["Yes", "No"], ["1", "0"])] }]) }), null, "a near title is a different market");
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win", ["Yes", "No"], ["0.62", "0.38"])] }]) }), null, "an unsettled price is not an answer");
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win", ["Yes", "No"], ["1", "0"], { closed: false })] }]) }), null, "an open market is not an answer");
const two = await polymarket("Bitcoin Up or Down - February 28", { fetchImpl: gamma([{ title: "t", markets: [mk("Bitcoin Up or Down - February 28", ["Up", "Down"], ["1", "0"], { closedTime: "2025-02-28" }), mk("Bitcoin Up or Down - February 28", ["Up", "Down"], ["0", "1"], { closedTime: "2026-02-28" })] }]) });
assert.equal(two.winner, "Down", "the most recently closed of a recurring title");
// the model budget: a slow model ends as "unresolved", never an exception
const slow = openrouter({ key: "k", models: ["a", "b"], budgetMs: 1500, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
// AbortSignal.timeout does not hold the event loop; a real fetch does (its socket), a mock must.
const hold = setTimeout(() => {}, 10_000);
const t0 = Date.now(); await assert.rejects(slow("p"), /no model answered/); clearTimeout(hold); assert.ok(Date.now() - t0 < 4000, "stays within the budget");
console.log("outcome rules: 39 checks ok");
