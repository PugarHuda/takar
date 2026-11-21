// Brief rules, no network.  node lib/brief.test.mjs
import assert from "node:assert/strict";
import { classify, claimStatus, checkClaim, summarise } from "./brief.mjs";
import { TAKAR_OUTCOME_ID } from "./scorecard.mjs";

const NOW = new Date("2026-11-21");
assert.equal(classify({ question: "Did India and Pakistan agree a ceasefire in May 2025?" }, NOW), "observation");
assert.equal(classify({ question: "Will India and Pakistan resume trade in 2027?" }, NOW), "forecast");
assert.equal(classify({ question: "Did the talks end by December 2026?" }, NOW), "forecast", "a period not over yet is a forecast");

const st = (...r) => claimStatus(r.map((reads) => ({ reads }))).status;
assert.equal(st("yes", "yes", null), "confirmed");
assert.equal(st("no", "no", null), "contradicted");
assert.equal(st("yes", null, null), "single-source", "one check is not certainty");
assert.equal(st("no", null), "single-source");
assert.equal(st("yes", "no", "yes"), "disputed", "disagreement is shown, never averaged");
assert.equal(st(null, null), "unsupported");

// checkClaim: our miner by id, the route, then FACT_CHECK; the route landing on our miner counts once
const calls = [];
const fake = async ({ intent, minerId }) => {
  calls.push([intent, minerId ?? "route"]);
  if (intent === "FACT_CHECK_GENERAL") return { result_shape: "intent", result: { verdict: "False" }, ledger: { miner: { id: "9002", name: "TxLens" }, paidMicroUsdc: "10000" }, signal_hash: "0xf" };
  return { result_shape: "intent", result: { outcome: "yes" }, ledger: { miner: { id: TAKAR_OUTCOME_ID }, paidMicroUsdc: "10000" }, signal_hash: "0xa" };
};
const r = await checkClaim({ id: "c1", question: "Did X happen in 2025?", claim: "X happened in 2025." }, { ask: fake });
assert.deepEqual(calls.map((c) => c[0]), ["EVENT_OUTCOME_RESOLUTION_GENERAL", "EVENT_OUTCOME_RESOLUTION_GENERAL", "FACT_CHECK_GENERAL"]);
assert.equal(calls[0][1], TAKAR_OUTCOME_ID);
assert.equal(r.checks.filter((c) => !c.duplicate).length, 2, "the route answered by the same miner is not a second check");
assert.equal(r.yes, 1, "one miner, one vote");
assert.equal(r.status, "disputed", "our miner said yes, the fact-check said false");
assert.equal(r.costUsd, 0.03, "every paid ask is costed, the duplicate too");

const failing = async () => { throw new Error("503 no_compatible_miner"); };
const f = await checkClaim({ id: "c2", question: "Did Y happen in 2025?", claim: "Y happened." }, { ask: failing });
assert.equal(f.status, "unsupported"); assert.equal(f.costUsd, 0);

const row = (id, kind, status, cost = 0.03, type = "observation") => ({ id, kind, type, result: { status, costUsd: cost } });
const s = summarise([row("a", "escalation", "confirmed"), row("b", "escalation", "disputed"), row("c", "de-escalation", "confirmed"), row("d", "escalation", "contradicted"), { id: "e", kind: "context", type: "forecast" }]);
assert.deepEqual([s.observations, s.forecasts, s.confirmed, s.contradicted, s.disputed], [4, 1, 2, 1, 1]);
assert.deepEqual(s.escalation, { confirmed_escalations: 1, confirmed_de_escalations: 1, net: 0, disputed: ["b"], single_source: [] }, "only confirmed claims move the tally");
assert.equal(s.cost_usd, 0.12); assert.equal(s.cost_per_settled_claim_usd, 0.04);
console.log("brief rules: 23 checks ok");
