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
const m2 = operatorMap([{ slug: "p", fee_address: "0x1", base_url: "https://api.coingecko.com/x", activation_status: "active" }, { slug: "q", fee_address: "0x2", base_url: "https://api.coingecko.com/y", activation_status: "active" }, { slug: "r", fee_address: "0x2", base_url: "https://other.example/z", activation_status: "active" }]);
assert.deepEqual(m2.shared_endpoints, [{ host: "api.coingecko.com", miners: 2, operators: 2 }], "one host, two operators");

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
console.log("network views: 22 checks ok");

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

// Miner status from the ledger.
{
  const { minerHealth } = await import("./network.mjs");
  const now = Date.parse("2026-11-23T00:00:00Z");
  const row = (id, status, fs, at = "2026-11-22T00:00:00Z", extra = {}) => JSON.stringify({ at, intent: "X", miner: { id, name: `m${id}` }, status, fieldStatus: fs, result: /^paid/.test(status) ? { a: 1 } : null, ...extra });
  const text = [row("1", "paid", { a: "ok" }), row("1", "paid", { a: "ok" }), row("1", "paid", { a: "missing" }), row("2", "failed", {}, undefined, { error: "timeout" }), row("2", "failed", {}), row("2", "paid", { a: "ok" }), row("3", "paid", { a: "ok" }, "2026-11-01T00:00:00Z"), row("3", "paid", { a: "ok" }, "2026-11-01T00:00:00Z"), row("3", "paid", { a: "ok" }, "2026-11-01T00:00:00Z")].join("\n");
  const h = minerHealth(text, { now });
  assert.deepEqual(h.map((m) => m.id), ["1", "2"], "old rows outside the window");
  assert.equal(h[0].complete_rate, 0.67);
  assert.equal(h[0].last_problem, "a missing");
  assert.equal(h[1].answered_rate, 0.33);
  console.log("miner health: 4 checks ok");
}

// Append-only audit: anchored prefixes still hash to their roots, and an edit is caught.
{
  const { auditAnchors } = await import("./network.mjs");
  const { merkleRoot } = await import("./anchor.mjs");
  const lines = ["{\"a\":1}", "{\"a\":2}", "{\"a\":3}"];
  const anchors = [{ at: "t1", tx: "0x1", items: [{ kind: "ledger-root", count: 2, digest: merkleRoot(lines.slice(0, 2)) }] }, { at: "t2", tx: "0x2", items: [{ kind: "ledger-root", count: 3, digest: merkleRoot(lines) }] }];
  assert.equal(auditAnchors(lines.join("\n") + "\n{\"a\":4}", anchors).all_match, true, "appending keeps every root");
  const edited = auditAnchors(["{\"a\":1}", "{\"a\":9}", "{\"a\":3}"].join("\n"), anchors);
  assert.equal(edited.all_match, false);
  assert.equal(edited.checks[0].why, "prefix changed since it was anchored");
  assert.equal(auditAnchors(lines[0], anchors).checks[1].why, "ledger is shorter than the anchored prefix");
  console.log("append-only audit: 4 checks ok");
}
