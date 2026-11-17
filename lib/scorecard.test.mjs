// Scorecard and signing rules, no network.  node lib/scorecard.test.mjs
import assert from "node:assert/strict";
import { brier, forecastAt, verifyOutcome, summarise } from "./scorecard.mjs";
import { canonical, newKeyPair, signDoc, verifyDoc } from "./sign.mjs";

assert.equal(brier(1, true), 0);
assert.equal(brier(0.7, false), 0.48999999999999994);

const market = { id: "m1", question: "Will Bitcoin hit $100K in 2024?", resolution: "YES", resolvedAt: Date.parse("2024-12-05T00:00:00Z") };
const fakeFetch = async (url) => ({ json: async () => (url.includes("beforeTime=" + (market.resolvedAt - 7 * 86_400_000)) ? [{ id: "b1", probAfter: 0.68471, createdTime: Date.parse("2024-11-28T03:00:00Z") }] : []) });
const f = await forecastAt(market, { fetchImpl: fakeFetch });
assert.equal(f.p, 0.6847);
assert.equal(f.asOf, "2024-11-28T03:00:00.000Z");

const answer = (outcome, shape = "intent") => async () => ({ result_shape: shape, result: { outcome }, ledger: { miner: { id: "9002" } }, signal_hash: "0x1" });
assert.equal((await verifyOutcome(market, { ask: answer("yes") })).status, "confirmed");
assert.equal((await verifyOutcome(market, { ask: answer("no") })).status, "contradicted");
assert.equal((await verifyOutcome(market, { ask: answer("unresolved") })).status, "unverified");
// An unreadable routed answer falls back to the next-ranked miner once.
let n = 0;
const flaky = async ({ minerId }) => (n++, minerId ? { result_shape: "intent", result: { outcome: "yes" }, ledger: { miner: { id: minerId } } } : { result_shape: "raw", result: {}, ledger: { miner: { id: "9002" } } });
const fb = await verifyOutcome(market, { ask: flaky, ranked: async () => [{ id: "9002" }, { id: "20261117" }] });
assert.equal(fb.status, "confirmed");
assert.equal(fb.attempts[1].miner.id, "20261117");
assert.equal(n, 2);

const rows = [
  { forecast: { p: 0.9 }, brier: 0.01, verification: { status: "confirmed" } },
  { forecast: { p: 0.2 }, brier: 0.64, verification: { status: "contradicted" } },
  { forecast: { p: 0.5 }, brier: 0.25, verification: { status: "unverified" } },
];
const s = summarise(rows);
assert.deepEqual([s.scored, s.contradicted, s.unverified, s.brier], [1, 1, 1, 0.01], "only confirmed rows are scored");

// Signatures: canonical JSON ignores key order; any edit breaks the signature.
assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
const { privateB64 } = newKeyPair();
const doc = { brier: 0.12, rows: [1, 2] };
const att = signDoc(doc, privateB64);
assert.equal(verifyDoc(doc, att), true);
assert.equal(verifyDoc({ ...doc, brier: 0.11 }, att), false);

console.log("scorecard rules: 15 checks ok");
