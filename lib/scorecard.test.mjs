// Scorecard and signing rules, no network.  node lib/scorecard.test.mjs
import assert from "node:assert/strict";
import { brier, forecastAt, verifyOutcome, summarise, verdictOf, logLoss, TAKAR_OUTCOME_ID } from "./scorecard.mjs";
import { canonical, newKeyPair, signDoc, verifyDoc } from "./sign.mjs";

assert.equal(brier(1, true), 0);
assert.equal(brier(0.7, false), 0.48999999999999994);

const market = { id: "m1", question: "Will Bitcoin hit $100K in 2024?", resolution: "YES", resolvedAt: Date.parse("2024-12-05T00:00:00Z") };
const fakeFetch = async (url) => ({ json: async () => (url.includes("beforeTime=" + (market.resolvedAt - 7 * 86_400_000)) ? [{ id: "b1", probAfter: 0.68471, createdTime: Date.parse("2024-11-28T03:00:00Z") }] : []) });
const f = await forecastAt(market, { fetchImpl: fakeFetch });
assert.equal(f.p, 0.6847);
assert.equal(f.asOf, "2024-11-28T03:00:00.000Z");

const answer = (outcome, shape = "intent") => async ({ minerId }) => ({ result_shape: shape, result: { outcome }, ledger: { miner: { id: minerId ?? "9002" } }, signal_hash: "0x1" });
const ok = await verifyOutcome(market, { ask: answer("yes") });
assert.equal(ok.status, "confirmed"); assert.equal(ok.agreeing, 2, "our miner and the routed one both asked");
assert.equal(ok.attempts[0].miner.id, TAKAR_OUTCOME_ID, "our own miner is asked by id");
assert.equal((await verifyOutcome(market, { ask: answer("no") })).status, "contradicted");
assert.equal((await verifyOutcome(market, { ask: answer("unresolved") })).status, "unverified");
// Two miners that disagree: listed as split, never scored.
const disagree = async ({ minerId }) => ({ result_shape: "intent", result: { outcome: minerId ? "yes" : "no" }, ledger: { miner: { id: minerId ?? "9002" } } });
assert.equal((await verifyOutcome(market, { ask: disagree })).status, "split");
// The route landing on a miner already asked counts once.
const same = async () => ({ result_shape: "intent", result: { outcome: "yes" }, ledger: { miner: { id: TAKAR_OUTCOME_ID } } });
assert.equal((await verifyOutcome(market, { ask: same })).agreeing, 1);
// No readable answer: the next-ranked untried miner is asked once.
let n = 0;
const flaky = async ({ minerId }) => (n++, minerId === "777" ? { result_shape: "intent", result: { outcome: "yes" }, ledger: { miner: { id: "777" } } } : { result_shape: "raw", result: {}, ledger: { miner: { id: minerId ?? "9002" } } });
const fb = await verifyOutcome(market, { ask: flaky, ranked: async () => [{ id: "9002" }, { id: TAKAR_OUTCOME_ID }, { id: "777" }] });
assert.equal(fb.status, "confirmed");
assert.equal(fb.attempts.at(-1).miner.id, "777");
assert.equal(n, 3);

const mk = (p, res, status, attempts = []) => ({ market: { resolution: res }, forecast: { p }, brier: +brier(p, res === "YES").toFixed(4), verification: { status, attempts, agreeing: 2 } });
const rows = [
  mk(0.9, "YES", "confirmed", [{ miner: { name: "A" }, outcome: "yes" }, { miner: { name: "B" }, outcome: "no" }]),
  mk(0.2, "YES", "contradicted", [{ miner: { name: "B" }, outcome: "no" }]),
  mk(0.5, "NO", "unverified", [{ miner: { name: "A" }, outcome: "unresolved" }]),
];
const s = summarise(rows);
assert.deepEqual([s.scored, s.contradicted, s.unverified, s.brier], [1, 1, 1, 0.01], "only confirmed rows are scored");
assert.equal(s.brier_skill, 0.96);
assert.equal(s.log_loss, +(-Math.log(0.9)).toFixed(4));
assert.equal(s.calibration.find((c) => c.bin === "0.8-1.0").n, 1);
assert.deepEqual(s.miners.map((m) => [m.miner, m.right, m.wrong, m.no_answer]), [["A", 1, 0, 1], ["B", 0, 2, 0]], "the scorecard grades the miners too");
assert.equal(logLoss(1, true), logLoss(0.99, true), "p is clipped");

// Signatures: canonical JSON ignores key order; any edit breaks the signature.
assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
const { privateB64 } = newKeyPair();
const doc = { brier: 0.12, rows: [1, 2] };
const att = signDoc(doc, privateB64);
assert.equal(verifyDoc(doc, att), true);
assert.equal(verifyDoc({ ...doc, brier: 0.11 }, att), false);

assert.equal(verdictOf({ verdict: "True" }), "agrees");
assert.equal(verdictOf({ answer: "False. The claim is false." }), "disagrees");
assert.equal(verdictOf({ verdict: "Mostly false" }), "disagrees");
assert.equal(verdictOf({ answer: "Sources disagree on this." }), "unclear");
assert.equal(verdictOf(null), "unclear");
console.log("scorecard rules: 31 checks ok");
