// Build the signed forecast scorecard (Mission 13).
//
//   node --env-file=.env scripts/scorecard-run.mjs [--per-topic 2] [--days 7]
//
// For each resolved market: read the crowd's probability N days before it
// resolved, buy the outcome through Telegraph, compare it with the market's own
// resolution, and score only what Telegraph confirmed. Costs $0.01 test USDC
// per ask (at most two per market). Writes receipts/scorecard.json, signed.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { ask, ranked } from "../lib/telegraph.mjs";
import { resolvedMarkets, forecastAt, verifyOutcome, brier, summarise } from "../lib/scorecard.mjs";
import { newKeyPair, signDoc } from "../lib/sign.mjs";

const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const PER_TOPIC = arg("--per-topic", 2);
const DAYS = arg("--days", 7);
const TOPICS = ["Federal Reserve", "CPI inflation", "Bitcoin", "S&P 500", "recession", "Nvidia", "Tesla"];
const SINCE = Date.parse("2023-01-01T00:00:00Z");

// One signing key for the scorecard, created on first run. Private half stays in .env.
let key = process.env.TAKAR_SIGNING_KEY;
if (!key) {
  const kp = newKeyPair();
  key = kp.privateB64;
  appendFileSync(".env", `\nTAKAR_SIGNING_KEY=${kp.privateB64}\n`);
  mkdirSync("keys", { recursive: true });
  writeFileSync("keys/takar-ed25519.pub", kp.publicB64 + "\n");
  console.log("created signing key; public half in keys/takar-ed25519.pub");
} else if (!existsSync("keys/takar-ed25519.pub")) {
  throw new Error("TAKAR_SIGNING_KEY is set but keys/takar-ed25519.pub is missing");
}

const run = new Date().toISOString();
const seen = new Set();
const markets = [];
for (const t of TOPICS) {
  for (const m of await resolvedMarkets(t, { limit: PER_TOPIC * 2, since: SINCE })) {
    // A year in the question keeps the resolution well defined.
    if (seen.has(m.id) || !/\b20\d{2}\b/.test(m.question)) continue;
    seen.add(m.id);
    markets.push(m);
    if (markets.filter((x) => x.topic === t).length >= PER_TOPIC) break;
  }
}
console.log(`${markets.length} markets`);

const rows = [];
for (const m of markets) {
  const forecast = await forecastAt(m, { days: DAYS });
  const verification = await verifyOutcome(m, { ask, ranked, run });
  const happened = m.resolution === "YES";
  const row = { market: m, forecast, verification, brier: forecast ? +brier(forecast.p, happened).toFixed(4) : null };
  rows.push(row);
  const by = verification.attempts.map((a) => `${a.miner?.name ?? a.miner?.id ?? "-"}:${a.outcome}`).join(", ");
  console.log(`${verification.status.padEnd(12)} p=${forecast?.p ?? "?"} ${m.resolution.padEnd(3)} | ${m.question.slice(0, 70)} | ${by}`);
}

const doc = {
  title: "Takar forecast scorecard",
  method: `Crowd probability on Manifold ${DAYS} days before resolution; outcome bought through Telegraph EVENT_OUTCOME_RESOLUTION_GENERAL and compared with the market's resolution; Brier score over confirmed outcomes only.`,
  generated_at: run,
  network: "Ethereum Sepolia testnet (test USDC)",
  summary: summarise(rows),
  rows,
};
const out = { ...doc, attestation: signDoc(doc, key) };
writeFileSync("receipts/scorecard.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.summary));
