// Second-opinion rules, no network.  node lib/second.test.mjs
import assert from "node:assert/strict";
import { same, compare, order, secondOpinion, quorumAnswer } from "./second.mjs";

assert.ok(same(100, 101.5), "numbers within 2%");
assert.ok(!same(100, 110));
assert.ok(same("Argentina ", "argentina"));
assert.ok(same("São Paulo", "Sao Paulo"), "accents aside");
assert.ok(!same(true, "true"), "a boolean only equals a boolean");
const c = compare({ price: 100, currency: "USD", sources: ["a"], as_of: "x" }, { price: 130, currency: "usd", sources: ["b"], note: "y" });
assert.deepEqual([c.compared, c.differ], [["price", "currency"], ["price"]], "metadata fields are never compared");

const nodeRank = [{ id: "1", slug: "a" }, { id: "2", slug: "b" }, { id: "3", slug: "c" }, { id: "4", slug: "d" }];
const rep = [{ minerId: "3", answered: 10, score: 0.8 }, { minerId: "1", answered: 10, score: 0.2 }, { minerId: "2", answered: 0, score: 0 }];
assert.deepEqual(order(nodeRank, rep, ["4"]).map((m) => m.id), ["3", "1", "2"], "on-chain record first, then node rank; excluded ids dropped");

const answers = { 1: { outcome: "yes", winner: "Argentina" }, 2: { outcome: "yes", winner: "argentina" }, 3: { outcome: "no", winner: null } };
const ask = async ({ minerId }) => ({ result_shape: answers[minerId] ? "intent" : "raw", result: answers[minerId] ?? {}, ledger: { miner: { id: minerId }, paidMicroUsdc: "10000" }, signal_hash: "0x" + minerId });
const ranked = async () => nodeRank;
const agree = await secondOpinion({ intent: "X", params: {} }, { ask, ranked });
assert.equal(agree.verdict, "agree"); assert.equal(agree.costUsd, 0.02);
const dis = await secondOpinion({ intent: "X", params: {} }, { ask, ranked, reputation: rep });
assert.equal(dis.verdict, "disagree", "miner 3 (best record) says no, miner 1 says yes");
assert.deepEqual(dis.differ, ["outcome"]);
const third = await secondOpinion({ intent: "X", params: {} }, { ask, ranked: async () => [{ id: "4" }, { id: "1" }, { id: "2" }] });
assert.equal(third.verdict, "agree", "an unusable answer brings in a third miner");
assert.equal(third.answers.length, 3);
const lonely = await secondOpinion({ intent: "X", params: {} }, { ask, ranked: async () => [{ id: "1" }] });
assert.equal(lonely.verdict, "insufficient");
// The node answering from a different miner than the one asked is not that miner's opinion.
const swapped = async ({ minerId }) => ({ result_shape: "intent", result: { outcome: "yes" }, ledger: { miner: { id: "9" } } });
assert.equal((await secondOpinion({ intent: "X", params: {} }, { ask: swapped, ranked })).verdict, "insufficient");
const abst = { 1: { outcome: "unresolved" }, 2: { outcome: "no" }, 3: { outcome: "no" } };
const ab = await secondOpinion({ intent: "X", params: {} }, { ask: async ({ minerId }) => ({ result_shape: "intent", result: abst[minerId] ?? {}, ledger: { miner: { id: minerId } } }), ranked: async () => [{ id: "1" }, { id: "2" }, { id: "3" }] });
assert.equal(ab.verdict, "agree", "an abstention is replaced by the next miner"); assert.equal(ab.answers[0].why, "abstained (unresolved)");
const sameOp = await secondOpinion({ intent: "X", params: {} }, { ask, ranked: async () => [{ id: "1" }, { id: "2" }, { id: "3" }], operatorOf: (id) => (id === "3" ? "0xB" : "0xA") });
assert.equal(sameOp.answers[1].why, "same operator as another answer", "one operator running two miners is one opinion");
assert.equal(sameOp.verdict, "disagree", "the third miner, from another operator, is asked instead");
const strict = await secondOpinion({ intent: "X", params: {} }, { ask, ranked, operatorOf: (id) => (id === "1" ? "0xA" : null), strictOperators: true });
assert.equal(strict.verdict, "insufficient", "unknown operators fail closed");
const q = quorumAnswer("E?", agree, "rule");
assert.equal(q.outcome, "yes"); assert.equal(q.confidence, "medium"); assert.equal(q.winner, "Argentina");
assert.equal(quorumAnswer("E?", { ...agree, answer: { outcome: "yes", winner: "yes" } }, "rule").winner, null, "an echoed outcome is not a winner"); assert.equal(q.sources.length, 2);
assert.equal(quorumAnswer("E?", dis, "rule"), null, "no quorum, no answer");
assert.equal(quorumAnswer("E?", { verdict: "agree", answer: { outcome: "unresolved" }, answers: [] }, "rule"), null, "agreeing on unresolved is not an answer");
console.log("second-opinion rules: 26 checks ok");
// Tolerance follows what the field measures; nested answers are compared field by field.
assert.ok(!same(100, 101, "price_usd"), "prices agree only within 0.5%");
assert.ok(same(20.4, 21.2, "temperature_c"), "temperatures within 1 degree");
assert.ok(!same(20, 22, "temperature_c"));
assert.ok(same(30, 32.5, "wind_gust_kmh"), "wind within 10%");
const nested = compare({ current: { temperature_c: 20, wind_kmh: 10 }, sources: [{ a: 1 }] }, { current: { temperature_c: 20.5, wind_kmh: 30 } });
assert.deepEqual([nested.compared, nested.differ], [["current.temperature_c", "current.wind_kmh"], ["current.wind_kmh"]], "nested fields compared, metadata still ignored");
assert.equal(nested.spread["current.temperature_c"], 0.5, "agreement has a width");
console.log("tolerance and nesting: 7 checks ok");
