// Network views, no network.  node lib/network.test.mjs
import assert from "node:assert/strict";
import { operatorMap, disagreementIndex, signalCheck } from "./network.mjs";
import { merkleRoot } from "./anchor.mjs";

// Five miners, three payout addresses; intent X has two operators, Y only one.
const miners = [
  { slug: "a1", fee_address: "0xAAA", supported_intents: ["X", "Y"], activation_status: "active" },
  { slug: "a2", fee_address: "0xaaa", supported_intents: ["X"], activation_status: "active" },
  { slug: "a3", fee_address: "0xaaa", supported_intents: ["Y"], activation_status: "active" },
  { slug: "b1", fee_address: "0xbbb", supported_intents: ["X"], activation_status: "active" },
  { slug: "c1", fee_address: "0xccc", supported_intents: ["Z"], activation_status: "inactive" },
];
const m = operatorMap(miners);
assert.equal(m.miners, 4, "inactive miners left out");
assert.equal(m.operators, 2, "addresses compared case-insensitively");
assert.equal(m.top_operators[0].miners, 3);
const x = m.intents.find((i) => i.intent === "X"), y = m.intents.find((i) => i.intent === "Y");
assert.deepEqual([x.miners, x.operators, x.top_operator_share, x.independent_pair_possible], [3, 2, 0.67, true]);
assert.equal(x.effective_operators, 1.8, "1 / (0.67^2 + 0.33^2)");
assert.deepEqual([y.miners, y.operators, y.independent_pair_possible], [2, 1, false], "two miners, one operator: no independent pair");
assert.equal(m.top_two_share, 1);

const d = disagreementIndex({ since: "s", calls: 9, by_intent: { E: { agree: 6, disagree: 3, insufficient: 2 }, S: { agree: 0, disagree: 0, insufficient: 1 } }, disagreements: [{ miners: ["2", "1"] }, { miners: ["1", "2"] }, { miners: ["3", "1"] }] });
const e = d.intents.find((i) => i.intent === "E");
assert.deepEqual([e.compared, e.rate], [9, 0.333], "insufficient pairs are not compared");
assert.ok(e.interval[0] < 0.333 && e.interval[1] > 0.333);
assert.equal(d.intents.find((i) => i.intent === "S").rate, null);
assert.deepEqual(d.pairs[0], { pair: "1 vs 2", disagreements: 2 }, "a pair counts the same in either order");

// A signal in the ledger, covered by an anchor whose root is recomputed from the file.
const H = "0x" + "ab".repeat(32);
const lines = [JSON.stringify({ at: "t0", signalHash: "0x" + "11".repeat(32) }), JSON.stringify({ at: "t1", intent: "I", signalHash: H, paidMicroUsdc: "10000", status: "paid" })];
const anchors = [{ tx: "0xa1", at: "a", items: [{ kind: "ledger-root", count: 1, digest: merkleRoot(lines.slice(0, 1)) }] }, { tx: "0xa2", at: "b", items: [{ kind: "ledger-root", count: 2, digest: merkleRoot(lines) }] }];
const s = await signalCheck(H.toUpperCase().replace("0X", "0x"), { ledgerText: lines.join("\n") + "\n", anchors, nodeFetch: async () => ({ ok: true, status: 200 }) });
assert.deepEqual([s.in_takar_ledger.line, s.in_takar_ledger.paid_usd], [2, 0.01]);
assert.equal(s.anchored.tx, "0xa2", "the first anchor that covers line 2");
assert.equal(s.anchored.matches, true);
assert.equal(s.anchored.proof_matches, true, "the line and its proof reach the anchored root");
assert.equal(s.anchored.proof.length, 1, "two leaves: one sibling");
const tampered = await signalCheck(H, { ledgerText: lines.join("\n").replace("t0", "tX"), anchors, nodeFetch: async () => ({ ok: false, status: 404 }) });
assert.equal(tampered.anchored.matches, false, "an edited earlier line breaks the anchored root");
assert.equal(tampered.on_node.found, false);
assert.equal((await signalCheck("0x" + "cd".repeat(32), { ledgerText: "", anchors: [], nodeFetch: async () => ({ ok: true }) })).in_takar_ledger, null);
await assert.rejects(signalCheck("0x12", { nodeFetch: async () => ({ ok: true }) }), /64 hex/);
console.log("network views: 21 checks ok");

// Inclusion proofs on an odd-sized tree, every leaf, and a changed line.
{
  const { merkleRoot: root, merkleProof, rootFromProof } = await import("./anchor.mjs");
  const L = Array.from({ length: 13 }, (_, i) => JSON.stringify({ n: i }));
  const R = root(L);
  assert.ok(L.every((l, i) => rootFromProof(l, merkleProof(L, i)) === R), "every leaf of 13 reaches the root");
  assert.notEqual(rootFromProof(L[7].replace("7", "8"), merkleProof(L, 7)), R, "a changed line does not");
  assert.throws(() => merkleProof(L, 13), /out of range/);
  console.log("inclusion proofs: 3 checks ok");
}
