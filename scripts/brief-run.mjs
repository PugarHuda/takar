// Build a signed country note priced per fact (Mission 05).
//
//   node --env-file=.env scripts/brief-run.mjs briefs/india-pakistan-2025.json
//   node --env-file=.env scripts/brief-run.mjs briefs/india-pakistan-2025.json --rescore
//
// --rescore re-applies the rules to the checks already bought (no new asks), so a
// rule change never means paying twice for the same fact.
// Each observation costs up to three asks ($0.03 test USDC): Takar Outcome by id,
// the ranked route, and FACT_CHECK. Forecasts cost nothing. Writes
// receipts/brief-<name>.json, signed with the scorecard's Ed25519 key.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { ask } from "../lib/telegraph.mjs";
import { classify, checkClaim, claimStatus, summarise, KINDS } from "../lib/brief.mjs";
import { signDoc } from "../lib/sign.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: brief-run.mjs <brief.json>");
const input = JSON.parse(readFileSync(file, "utf8"));
const key = process.env.TAKAR_SIGNING_KEY;
if (!key) throw new Error("TAKAR_SIGNING_KEY is not set (run the scorecard once to create it)");
for (const c of input.claims) {
  if (!c.id || !c.claim || !c.question || !KINDS.includes(c.kind)) throw new Error(`claim ${c.id ?? "?"}: needs id, claim, question and kind (${KINDS.join(" | ")})`);
}

const out = `receipts/brief-${basename(file, ".json")}.json`;
const rescore = process.argv.includes("--rescore");
const previous = rescore ? JSON.parse(readFileSync(out, "utf8")) : null;
const bought = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
const run = previous?.generated_at ?? new Date().toISOString();
const rows = [];
for (const c of input.claims) {
  const type = classify(c);
  const t0 = Date.now();
  const old = bought.get(c.id);
  if (rescore && type === "observation" && !old?.result?.checks?.length) throw new Error(`--rescore: ${c.id} has no bought checks; run without --rescore`);
  const result = type !== "observation" ? { status: "forecast", checks: [], costUsd: 0 }
    : rescore ? { ...old.result, ...claimStatus(old.result.checks) }
    : await checkClaim(c, { ask, run });
  rows.push({ ...c, type, result, ms: old?.ms ?? Date.now() - t0 });
  const by = result.checks.map((k) => `${k.via === "FACT_CHECK" ? "fact-check" : (k.miner?.name ?? k.miner?.id ?? "route")}:${k.answer}${k.duplicate ? "(dup)" : ""}`).join(", ");
  console.log(`${result.status.padEnd(12)} ${c.id} ${c.kind.padEnd(13)} ${c.claim.slice(0, 70)} | ${by} | $${result.costUsd}`);
}

const doc = {
  title: input.title,
  customer: input.customer,
  note: input.note,
  method: "Each observation is bought through Telegraph from three checks: EVENT_OUTCOME_RESOLUTION from Takar Outcome (asked by id), EVENT_OUTCOME_RESOLUTION from the ranked route, and FACT_CHECK on the claim as a sentence. Checks are not averaged: a claim is confirmed (or contradicted) only when two or more checks agree and none disagrees; a lone yes or no is single-source and not counted; yes and no together is disputed; no yes or no is unsupported. Forecasts are listed and not bought. The escalation tally counts confirmed claims only.",
  generated_at: run,
  ...(rescore ? { rescored_at: new Date().toISOString() } : {}),
  network: "Ethereum Sepolia testnet (test USDC, Telegraph escrow)",
  summary: summarise(rows),
  rows,
};
writeFileSync(out, JSON.stringify({ ...doc, attestation: signDoc(doc, key) }, null, 2) + "\n");
console.log(JSON.stringify(doc.summary));
console.log(`wrote ${out}`);
