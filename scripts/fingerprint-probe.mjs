// Targeted test of the value fingerprint: the same question, at the same moment, to two miners on
// different payout addresses whose registry entries call the same API, and to a control pair whose
// entries call different APIs. Testnet escrow, about $0.01 per answer.
//
//   node --env-file=.env scripts/fingerprint-probe.mjs   -> receipts/fingerprint-probe.json
import { writeFileSync } from "node:fs";
import { ask } from "../lib/telegraph.mjs";
import { fingerprint, independence } from "../lib/second.mjs";

const PAIRS = [
  { kind: "same upstream (api.coingecko.com)", intent: "CRYPTO_PRICE_USD", miners: ["32001", "7311"], questions: [{ symbol: "BTC" }, { symbol: "ETH" }, { symbol: "LINK" }] },
  { kind: "control (Coinbase vs CoinGecko)", intent: "CRYPTO_PRICE_USD", miners: ["32002", "32001"], questions: [{ symbol: "BTC" }, { symbol: "ETH" }, { symbol: "LINK" }] },
  { kind: "same upstream (api.llama.fi)", intent: "TVL_LOOKUP_GENERAL", miners: ["38003", "7312"], questions: [{ protocol: "aave" }, { protocol: "lido" }] },
  { kind: "same upstream (api.open-meteo.com)", intent: "WEATHER_FORECAST_GENERAL", miners: ["35001", "9603"], questions: [{ location: "Jakarta, Indonesia", window_hours: 24 }] },
];
const run = new Date().toISOString();
const rows = [];
for (const p of PAIRS) for (const params of p.questions) {
  const [a, b] = await Promise.all(p.miners.map((minerId) => ask({ intent: p.intent, params, minerId, purpose: "fingerprint-probe", run }).catch((e) => ({ error: e.message }))));
  const ra = a.result ?? null, rb = b.result ?? null;
  const ok = ra && rb && typeof ra === "object" && typeof rb === "object";
  const row = { kind: p.kind, intent: p.intent, params, miners: p.miners, a: ra, b: rb, identical: ok ? fingerprint(ra, rb) : null, level: ok ? independence(ra, rb).level : null, error: ok ? null : (a.error ?? b.error ?? "unusable answer") };
  rows.push(row);
  console.log(p.kind.padEnd(36), JSON.stringify(params).padEnd(44), row.error ?? `${row.level}  ${JSON.stringify(row.identical)}`);
}
writeFileSync("receipts/fingerprint-probe.json", JSON.stringify({ title: "Value fingerprint: same question, same moment, pairs sharing an upstream API vs a control pair", run, rows }, null, 2) + "\n");
