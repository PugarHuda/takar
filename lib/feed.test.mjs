// Feed and miner-report rules, no network.  node lib/feed.test.mjs
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { encodeFeed, decodeFeed, summariseFeed, FEED_SCHEMA } from "./feed.mjs";
import { minerReport, badge } from "./minerreport.mjs";
import { sampleHonesty } from "./scorecard.mjs";

const so = { intent: "X_GENERAL", verdict: "disagree", differ: ["outcome"], answers: [
  { usable: false, miner: { id: "7" } },
  { usable: true, miner: { id: "1" }, signal: "0x" + "a".repeat(64) },
  { usable: true, miner: { id: "2" }, signal: "0x" + "b".repeat(64) }] };
const data = encodeFeed(so, "my-app");
const vals = ethers.AbiCoder.defaultAbiCoder().decode(FEED_SCHEMA.split(",").map((f) => f.split(" ")[0]), data);
assert.deepEqual([vals[1], vals[2], vals[5], vals[6], vals[7]], [1n, 2n, 2n, "outcome", "my-app"], "the compared pair is recorded, not the unusable first try");
const json = (o) => JSON.stringify(Object.entries(o).map(([name, value]) => ({ name, value: { value } })));
const row = decodeFeed({ id: "0x1", attester: "0xA", time: 1700000000, decodedDataJson: json({ intent: "X_GENERAL", minerA: { type: "BigNumber", hex: "0x01" }, minerB: "2", signalA: "0x" + "a".repeat(64), signalB: ethers.ZeroHash, verdict: 2, differ: "outcome", client: "" }) });
assert.equal(row.minerA, "1"); assert.equal(row.verdict, "disagree"); assert.equal(row.client, null);
const sum = summariseFeed([row, { ...row, verdict: "agree", client: "x" }]);
assert.equal(sum.calls, 2); assert.equal(sum.verdicts.disagree, 1); assert.equal(sum.clients.unnamed, 1);
assert.equal(sum.disagreements[0].signals.length, 1, "a zero signal is not linked");

const rep = minerReport({
  scores: [{ epoch_id: 30, intent_id: "E", score: 0.99, rank: 2, failure_reason: "" }, { epoch_id: 29, intent_id: "E", score: 0, rank: 17, failure_reason: "" }],
  checks: [{ intent_id: "E", passed: true }], statuses: [{ intent_id: "E", status: "online" }],
  evidence: [{ intent: "E", right: 1, wrong: 3, unusable: 0, abstained: 2, score: 0.05 }] });
assert.equal(rep[0].latest.epoch, 30); assert.equal(rep[0].best.score, 0.99);
assert.equal(rep[0].flags.length, 2, "one silent zero, and paid answers mostly wrong");
assert.ok(badge("a<b", "c").includes("a&lt;b"), "badge text is escaped");

const h = sampleHonesty([{ p: 0.01, y: false, b: 0.0001 }, { p: 0.5, y: true, b: 0.25 }, { p: 0.95, y: true, b: 0.0025 }]);
assert.equal(h.contested, 1); assert.equal(h.near_certain, 2); assert.equal(h.brier_contested, 0.25);
assert.ok(h.brier_ci95[0] <= h.brier_ci95[1]); assert.ok(h.caveat);
console.log("feed, miner report, sample honesty: 17 checks ok");
// Ledger anchors: a root changes when any line changes or goes missing.
{
  const { merkleRoot, ledgerLines } = await import("./anchor.mjs");
  const ls = ledgerLines('{"a":1}\r\n{"b":2}\n{"c":3}\n');
  assert.equal(ls.length, 3, "CR and the trailing newline are not lines");
  const r = merkleRoot(ls);
  assert.notEqual(merkleRoot([ls[0], ls[2]]), r, "a deleted line changes the root");
  assert.notEqual(merkleRoot([ls[0], '{"b":3}', ls[2]]), r, "an edited line changes the root");
  assert.equal(merkleRoot(ledgerLines('{"a":1}\n{"b":2}\n{"c":3}')), r, "same lines, same root");
  console.log("anchors: 4 checks ok");
}
