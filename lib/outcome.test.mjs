// Outcome resolver rules, no network.  node lib/outcome.test.mjs
import assert from "node:assert/strict";
import { tableRows, RULES, ROW, latestPeriodEnd, notYetDecidable, resolve, excerpt, polymarket, openrouter, matchMarket } from "./outcome.mjs";

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
assert.equal(ud.winner, "Down"); assert.equal(ud.outcome, "yes", "outcome stays in yes|no|unresolved"); assert.equal(ud.resolved_yes, true);
assert.ok(ud.sources[0].endsWith("/btc-feb-28") && ud.evidence.includes("Down"));
const yn = await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "Mets vs Braves", markets: [mk("New York Mets to win", ["Yes", "No"], ["1", "0"])] }]) });
assert.equal(yn.outcome, "yes"); assert.equal(yn.resolved_yes, true); assert.equal(yn.winner, null);
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win the World Series", ["Yes", "No"], ["1", "0"])] }]) }), null, "a near title is a different market");
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win", ["Yes", "No"], ["0.62", "0.38"])] }]) }), null, "an unsettled price is not an answer");
assert.equal(await polymarket("New York Mets to win", { fetchImpl: gamma([{ title: "x", markets: [mk("New York Mets to win", ["Yes", "No"], ["1", "0"], { closed: false })] }]) }), null, "an open market is not an answer");
const two = await polymarket("Bitcoin Up or Down - February 28", { fetchImpl: gamma([{ title: "t", markets: [mk("Bitcoin Up or Down - February 28", ["Up", "Down"], ["1", "0"], { closedTime: "2025-02-28" }), mk("Bitcoin Up or Down - February 28", ["Up", "Down"], ["0", "1"], { closedTime: "2026-02-28" })] }]) });
assert.equal(two.winner, "Down", "the most recently closed of a recurring title");
// the scorer's own phrasing (21 Nov log): a market title plus "Resolution" / "Resolve this market."
const cs = [{ title: "Counter-Strike: LPH Gaming vs Sangal ALTERS (BO3) - United21 Group A", slug: "cs2-lph-sng-2026-04-27", markets: [mk("Counter-Strike: LPH Gaming vs Sangal ALTERS - Map 1 Winner", ["LPH Gaming", "Sangal ALTERS"], ["0", "1"])] }];
assert.equal((await polymarket("Counter-Strike: LPH Gaming vs Sangal ALTERS - Map 1 Winner Resolution", { fetchImpl: gamma(cs) })).winner, "Sangal ALTERS");
assert.equal((await polymarket("Counter-Strike: LPH Gaming vs Sangal ALTERS - Map 1 Winner. Resolve this market.", { fetchImpl: gamma(cs) })).winner, "Sangal ALTERS");
// the model budget: a slow model ends as "unresolved", never an exception
const slow = openrouter({ key: "k", models: ["a", "b"], budgetMs: 1500, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
// AbortSignal.timeout does not hold the event loop; a real fetch does (its socket), a mock must.
const hold = setTimeout(() => {}, 10_000);
const t0 = Date.now(); await assert.rejects(slow("p"), /no model answered/); clearTimeout(hold); assert.ok(Date.now() - t0 < 4000, "stays within the budget");
// dated match questions: the real Polymarket shape of a Bundesliga fixture (20 Nov probe)
const fixture = [{ title: "1. FC Heidenheim 1846 vs. 1. FSV Mainz 05", slug: "bun-hei-mai-2026-05-16", endDate: "2026-05-16T13:30:00Z", markets: [
  { question: "Will 1. FC Heidenheim 1846 win on 2026-05-16?", outcomes: '["Yes", "No"]', outcomePrices: '["0", "1"]', closed: true },
  { question: "Will 1. FC Heidenheim 1846 vs. 1. FSV Mainz 05 end in a draw?", outcomes: '["Yes", "No"]', outcomePrices: '["0", "1"]', closed: true },
  { question: "Will 1. FSV Mainz 05 win on 2026-05-16?", outcomes: '["Yes", "No"]', outcomePrices: '["1", "0"]', closed: true } ] }];
assert.equal(matchMarket("Did the 2026-05-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match end in a draw?", fixture).label, "No");
assert.equal(matchMarket("Did 1. FSV Mainz 05 win the 2026-05-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match?", fixture).label, "Yes");
assert.equal(matchMarket("Did 1. FC Heidenheim 1846 win the 2026-05-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match?", fixture).label, "No");
assert.equal(matchMarket("Did the 2025-02-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match end in a draw?", fixture), null, "another date is another match");
const whoWon = matchMarket("Who won the 2026-05-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match?", fixture);
assert.equal(whoWon.winner, "1. FSV Mainz 05", "who won: the one team whose win market settled Yes");
const drawn = JSON.parse(JSON.stringify(fixture)); drawn[0].markets[2].outcomePrices = '["0", "1"]'; drawn[0].markets[1].outcomePrices = '["1", "0"]';
assert.equal(matchMarket("Who won the 2026-05-16 1. FC Heidenheim 1846 vs 1. FSV Mainz 05 match?", drawn), null, "a draw has no winner to name");
assert.equal(matchMarket("Did the 2026-05-16 Heidenheim vs Mainz match end in a draw?", fixture), null, "the full event title must be in the question");
// resolve() asks Polymarket first: a settled market answers without Wikipedia or a model
const routed = async (url) => url.startsWith("https://gamma-api.polymarket.com/public-search")
  ? { ok: true, json: async () => ({ events: [{ title: "t", slug: "s", markets: [{ question: "Will the Atlanta Braves win 100 or more games during the 2026 MLB Regular Season?", outcomes: '["Yes", "No"]', outcomePrices: '["0", "1"]', closed: true }] }] }) }
  : (() => { throw new Error("should not reach " + url); })();
const viaMarket = await resolve("Will the Atlanta Braves win 100 or more games during the 2026 MLB Regular Season?", { llm: async () => { throw new Error("no model needed"); }, fetchImpl: routed, now: new Date("2026-11-20") });
assert.equal(viaMarket.outcome, "no"); assert.equal(viaMarket.note, "settled prediction market");
assert.equal(viaMarket.confidence, "high"); assert.equal(viaMarket.resolution_rule, RULES.market);
// Tables: results that live only in a table reach the model as "cell | cell" rows (FOMC shape)
const FOMC = `<table><tr><th>Date</th><th>Fed funds rate</th><th>Change</th></tr>
<tr><td>September 17, 2025</td><td>4.00%&ndash;4.25%</td><td>&minus;25 bp<sup>[12]</sup></td></tr>
<tr><td>July 30, 2025</td><td>4.25%&#8211;4.50%</td><td>0 bp</td></tr>
<tr><td>December 18, 2024</td><td>4.25%&#8211;4.50%</td><td>&minus;25 bp</td></tr></table>`;
const tr = tableRows(FOMC, "Did the Fed cut rates in September 2025?");
assert.ok(tr.includes("September 17, 2025 | 4.00%–4.25% | −25 bp"), tr);
assert.ok(!tr.includes("[12]"), "footnote markers dropped");
assert.ok(!tr.includes("December 18, 2024"), "rows without the year or a name are left out");
const withTable = async (url) => ({ json: async () => (url.includes("list=search") ? { query: { search: [{ title: "History of FOMC actions" }] } }
  : url.includes("action=parse") ? { parse: { text: FOMC } }
  : { query: { pages: { 1: { title: "History of FOMC actions", fullurl: "https://en.wikipedia.org/wiki/FOMC", extract: "The Federal Open Market Committee sets the federal funds rate." } } } }) });
const fed = await resolve("Did the Fed cut rates in September 2025?", { llm: llm({ outcome: "yes", evidence: "September 17, 2025 | 4.00%–4.25%" }), fetchImpl: withTable, now: NOW });
assert.equal(fed.outcome, "yes", "a table row is quotable evidence"); assert.equal(fed.confidence, "medium");
const stitch = await resolve("Did the Fed cut rates in September 2025?", { llm: llm({ outcome: "yes", evidence: `−25 bp ${ROW} July 30, 2025 | 4.25%–4.50%` }), fetchImpl: withTable, now: NOW });
assert.equal(stitch.outcome, "unresolved", "a quote may not run across two table rows");
assert.doesNotThrow(() => tableRows("<tr><td>2025 &#99999999; Fed</td></tr>", "Fed 2025"), "an out-of-range entity is replaced, not thrown");
const none = await resolve("Did Max Verstappen win the 2025 Japanese Grand Prix?", { llm: async () => "I think yes", fetchImpl: fakeFetch, now: NOW });
assert.equal(none.confidence, "none");
console.log("outcome rules: 59 checks ok");
// The year in the question weighs a table row (the regex once held backspace characters).
{
  const { tableRows } = await import("./outcome.mjs");
  const html = "<table><tr><td>2018</td><td>France</td><td>Croatia</td></tr><tr><td>2022</td><td>Argentina</td><td>France</td></tr></table>";
  const rows = tableRows(html, "Who won the 2022 FIFA World Cup final against France?", 30);
  assert.ok(rows.startsWith("2022") && !rows.includes("2018"), "with room for one row, the row with the asked year is the one kept");
  console.log("table year weighting: 1 check ok");
}
{
  // A paid key goes first; when its budget is spent (4xx) the free models still answer.
  const seen = [];
  const f = (status, body) => async (u, o) => { seen.push(`${u.includes("sumopod") ? "paid" : "free"}:${JSON.parse(o.body).model}`); return { ok: status === 200, status, json: async () => body }; };
  const ok = { choices: [{ message: { content: "{\"outcome\":\"yes\"}" } }] };
  assert.equal(await openrouter({ key: "k", paidKey: "p", models: ["a"], fetchImpl: f(200, ok) })("q"), "{\"outcome\":\"yes\"}");
  assert.deepEqual(seen, ["paid:gpt-4o-mini"], "paid first");
  seen.length = 0;
  const spent = async (u, o) => (u.includes("sumopod") ? (seen.push("paid"), { ok: false, status: 400, json: async () => ({}) }) : f(200, ok)(u, o));
  assert.equal(await openrouter({ key: "k", paidKey: "p", models: ["a"], fetchImpl: spent })("q"), "{\"outcome\":\"yes\"}");
  assert.deepEqual(seen, ["paid", "free:a"], "a spent budget falls through to the free models");
  assert.equal(await openrouter({ paidKey: "p", fetchImpl: f(200, ok) })("q"), "{\"outcome\":\"yes\"}", "paid alone works without an OpenRouter key");
  console.log("paid model first, free fallback: 5 checks ok");
}
{
  // A full date ends that day, not that year (22 Nov: "April 15th, 2026" was read as all of 2026).
  assert.equal(latestPeriodEnd("Will Brent Crude Oil close above $120 on April 15th, 2026?").toISOString().slice(0, 10), "2026-04-16");
  assert.equal(latestPeriodEnd("Islanders game on 25 October 2026").toISOString().slice(0, 10), "2026-10-26");
  assert.equal(latestPeriodEnd("Did Hoffenheim win on 2024-12-01?").toISOString().slice(0, 10), "2024-12-02");
  assert.equal(latestPeriodEnd("at the end of Feb 2024?").toISOString().slice(0, 10), "2024-03-01", "month abbreviations pin the month");
  // A Wikipedia call that times out costs its own result, never the whole answer (it threw on 22 Nov).
  const hang = async (url) => (url.includes("wikipedia") ? Promise.reject(new Error("The operation was aborted due to timeout")) : { ok: true, json: async () => [] });
  const r = await resolve("Did Argentina win the 2022 FIFA World Cup?", { llm: async () => "{}", fetchImpl: hang, now: NOW });
  assert.equal(r.outcome, "unresolved"); assert.equal(r.note, "no source found");
  console.log("dates and Wikipedia outages: 6 checks ok");
}
