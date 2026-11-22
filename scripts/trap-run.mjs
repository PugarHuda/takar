// Known-answer test for the top EVENT_OUTCOME miners, Takar's own included.
//
//   node --env-file=.env scripts/trap-run.mjs          # 6 questions x up to 5 miners, $0.01 each (test USDC)
//   node --env-file=.env scripts/attest.mjs --send     # then the answers go to EAS with the rest
//
// Each question is a settled market whose own resolution and the official series agree
// (receipts/numeric-holdout-4.json and -6.json). The output has the scorecard's shape, so
// lib/reputation.mjs fromScorecard grades it: right, wrong, abstained or unusable.
import { writeFileSync } from "node:fs";
import { ask, ranked } from "../lib/telegraph.mjs";

const TAKAR = "20261117";
const TRAPS = [
  { id: "btc-100k-2023", question: "At any point during 2023 will bitcoin be worth over $100,000.00?", resolution: "NO", url: "https://manifold.markets/NathanDickson/at-any-point-during-2023-will-bitco" },
  { id: "eth-5k-2024", question: "Will Ethereum trade above $5k at any point in 2024?", resolution: "NO" },
  { id: "sp500-up-2024", question: "Will the S&P 500 increase in 2024?", resolution: "YES" },
  { id: "fed-hike-mar-2023", question: "Will the Fed raise the fed funds rate in the March 2023 meeting?", resolution: "YES" },
  { id: "fed-cut-may-2023", question: "Will the Fed lower the fed funds rate in the May 2023 meeting?", resolution: "NO" },
  { id: "btc-50k-end-2024", question: "Will Bitcoin price be above $50,000 at the end of 2024?", resolution: "YES" },
];
// URLs come from the holdout files, so a trap's truth is traceable to the market that settled it.
import { readFileSync } from "node:fs";
// --traps <file>: a harder set from scripts/trap-pick.mjs (recent markets, picked without consulting Takar).
const ti = process.argv.indexOf("--traps");
if (ti > 0) TRAPS.splice(0, TRAPS.length, ...JSON.parse(readFileSync(process.argv[ti + 1], "utf8")).traps.map((t) => ({ id: t.id, question: t.question, resolution: t.resolution, url: t.url })));
for (const n of [4, 6]) for (const r of JSON.parse(readFileSync(`receipts/numeric-holdout-${n}.json`, "utf8")).rows) {
  const t = TRAPS.find((x) => x.question === r.question);
  if (t) t.url ??= r.url;
}
if (TRAPS.some((t) => !t.url)) throw new Error("a trap has no market url: " + TRAPS.filter((t) => !t.url).map((t) => t.id));

const top = (await ranked("EVENT_OUTCOME_RESOLUTION_GENERAL")).slice(0, 4).map((m) => String(m.id));
const miners = [...new Set([...top, TAKAR])];
const run = `trap-${ti > 0 ? "hard-" : ""}${new Date().toISOString().slice(0, 10)}`;
console.log(`${TRAPS.length} traps x ${miners.length} miners: ${miners.join(", ")}`);

const rows = [];
for (const t of TRAPS) {
  const attempts = [];
  for (const id of miners) {
    try {
      const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: t.question }, minerId: id, unit: "trap", run, purpose: `trap:${t.id}` });
      attempts.push({ miner: r.ledger?.miner ?? { id }, outcome: (r.result_shape === "intent" ? r.result?.outcome : null) ?? "unreadable", signal: r.signal_hash ?? null });
    } catch (err) {
      attempts.push({ miner: { id }, outcome: "error", error: String(err.message).slice(0, 140) });
    }
  }
  rows.push({ market: { id: t.id, question: t.question, resolution: t.resolution, url: t.url }, verification: { attempts } });
  console.log(t.id, t.resolution, attempts.map((a) => `${a.miner.id}:${a.outcome}`).join(" "));
}
// Per-miner tally, for the page and the post.
const tally = Object.fromEntries(miners.map((id) => [id, { right: 0, wrong: 0, abstained: 0, unusable: 0 }]));
for (const r of rows) for (const a of r.verification.attempts) {
  const want = r.market.resolution.toLowerCase();
  const k = a.outcome === want ? "right" : a.outcome === "yes" || a.outcome === "no" ? "wrong" : a.outcome === "unresolved" ? "abstained" : "unusable";
  tally[String(a.miner.id)][k]++;
}
const file = `receipts/${run}.json`;
writeFileSync(file, JSON.stringify({ title: "Known-answer test, top EVENT_OUTCOME miners", generated_at: new Date().toISOString(), miners, tally, rows }, null, 2) + "\n");
console.log(file, JSON.stringify(tally));
